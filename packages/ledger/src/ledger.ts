import { and, eq, sql } from 'drizzle-orm';
import type { LedgerDb, LedgerTx } from './db.js';
import {
  IdempotencyConflictError,
  InvalidRequestError,
  InvalidStateError,
  UnknownMandateError,
  UnknownPaymentError,
} from './errors.js';
import { balances, ledgerEntries, payments } from './schema.js';

export type Balance = typeof balances.$inferSelect;
export type PaymentStatus = (typeof payments.$inferSelect)['status'];

export interface OpenBalanceInput {
  mandateId: string;
  currency: string;
  budgetMinor: number;
}

export interface SubmitInput {
  mandateId: string;
  idempotencyKey: string;
  merchant: string;
  amountMinor: number;
  currency: string;
}

export interface ReverseInput {
  paymentId: string;
  idempotencyKey: string;
}

export interface PaymentResult {
  paymentId: string;
  status: PaymentStatus;
  reasons: string[];
  replayed: boolean;
}

export interface LockedContext {
  tx: LedgerTx;
  balance: Balance;
}

export interface Decision {
  action: 'execute' | 'hold' | 'reject';
  reasons: string[];
}

/** Runs inside the transaction with the balance row locked. This is where policy plugs in. */
export type Decide = (context: LockedContext) => Decision | Promise<Decision>;

/** Runs under the same lock at capture time. Any reason returned keeps the hold in place. */
export type Recheck = (context: LockedContext) => string[] | Promise<string[]>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY = /^[A-Z]{3}$/;

export function assertPositiveMinor(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidRequestError(`${field} must be a positive integer in minor units`);
  }
}

export function assertNonEmpty(value: unknown, field: string) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidRequestError(`${field} must be a non-empty string`);
  }
}

export function assertUuid(value: unknown, field: string) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new InvalidRequestError(`${field} must be a UUID`);
  }
}

export function assertCurrency(value: unknown) {
  if (typeof value !== 'string' || !CURRENCY.test(value)) {
    throw new InvalidRequestError('currency must be a three-letter uppercase code');
  }
}

function toResult(
  payment: typeof payments.$inferSelect,
  replayed: boolean,
): PaymentResult {
  return {
    paymentId: payment.id,
    status: payment.status,
    reasons: payment.reasons,
    replayed,
  };
}

export async function lockBalance(tx: LedgerTx, mandateId: string) {
  const [balance] = await tx
    .select()
    .from(balances)
    .where(eq(balances.mandateId, mandateId))
    .for('update');
  if (!balance) throw new UnknownMandateError(mandateId);
  return balance;
}

async function findByKey(tx: LedgerTx, mandateId: string, idempotencyKey: string) {
  const [payment] = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.mandateId, mandateId), eq(payments.idempotencyKey, idempotencyKey)));
  return payment;
}

async function findPayment(db: LedgerDb | LedgerTx, paymentId: string) {
  assertUuid(paymentId, 'paymentId');
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!payment) throw new UnknownPaymentError(paymentId);
  return payment;
}

async function reloadPayment(tx: LedgerTx, paymentId: string) {
  const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId));
  return payment!;
}

async function adjustBalance(
  tx: LedgerTx,
  mandateId: string,
  delta: { spentMinor?: number; heldMinor?: number },
) {
  await tx
    .update(balances)
    .set({
      spentMinor: sql`${balances.spentMinor} + ${delta.spentMinor ?? 0}`,
      heldMinor: sql`${balances.heldMinor} + ${delta.heldMinor ?? 0}`,
    })
    .where(eq(balances.mandateId, mandateId));
}

/** Debits the merchant and credits the mandate. A negative amount writes the reversal. */
async function writeEntries(
  tx: LedgerTx,
  payment: typeof payments.$inferSelect,
  amountMinor: number,
) {
  await tx.insert(ledgerEntries).values([
    {
      paymentId: payment.id,
      account: `merchant:${payment.merchant}`,
      amountMinor,
      currency: payment.currency,
    },
    {
      paymentId: payment.id,
      account: `mandate:${payment.mandateId}`,
      amountMinor: -amountMinor,
      currency: payment.currency,
    },
  ]);
}

const executeByDefault: Decide = () => ({ action: 'execute', reasons: [] });
const noRecheck: Recheck = () => [];

export function createLedger(db: LedgerDb) {
  return {
    async openBalance(input: OpenBalanceInput, client: LedgerDb | LedgerTx = db) {
      assertUuid(input.mandateId, 'mandateId');
      assertCurrency(input.currency);
      assertPositiveMinor(input.budgetMinor, 'budgetMinor');
      await client.insert(balances).values(input);
    },

    async getBalance(mandateId: string): Promise<Balance> {
      assertUuid(mandateId, 'mandateId');
      const [balance] = await db.select().from(balances).where(eq(balances.mandateId, mandateId));
      if (!balance) throw new UnknownMandateError(mandateId);
      return balance;
    },

    async submit(input: SubmitInput, decide: Decide = executeByDefault): Promise<PaymentResult> {
      assertUuid(input.mandateId, 'mandateId');
      assertNonEmpty(input.idempotencyKey, 'idempotencyKey');
      assertNonEmpty(input.merchant, 'merchant');
      assertPositiveMinor(input.amountMinor, 'amountMinor');
      assertCurrency(input.currency);

      return db.transaction(async (tx) => {
        const balance = await lockBalance(tx, input.mandateId);

        // The key check must follow the lock: under READ COMMITTED this statement then sees any
        // payment committed by whoever held the lock before us.
        const existing = await findByKey(tx, input.mandateId, input.idempotencyKey);
        if (existing) {
          const sameRequest =
            existing.kind === 'payment' &&
            existing.merchant === input.merchant &&
            existing.amountMinor === input.amountMinor &&
            existing.currency === input.currency;
          if (!sameRequest) throw new IdempotencyConflictError(input.idempotencyKey);
          return toResult(existing, true);
        }

        // decide runs before the ledger's own checks so policy can log every proposal.
        let decision = await decide({ tx, balance });

        const committed = balance.spentMinor + balance.heldMinor;
        if (input.currency !== balance.currency) {
          decision = { action: 'reject', reasons: ['CURRENCY_MISMATCH'] };
        } else if (
          decision.action !== 'reject' &&
          committed + input.amountMinor > balance.budgetMinor
        ) {
          decision = { action: 'reject', reasons: ['BUDGET_EXCEEDED'] };
        }

        const status = (
          { execute: 'executed', hold: 'held', reject: 'rejected' } as const
        )[decision.action];
        const [payment] = await tx
          .insert(payments)
          .values({ ...input, status, reasons: decision.reasons })
          .returning();

        if (status === 'executed') {
          await adjustBalance(tx, input.mandateId, { spentMinor: input.amountMinor });
          await writeEntries(tx, payment!, input.amountMinor);
        } else if (status === 'held') {
          await adjustBalance(tx, input.mandateId, { heldMinor: input.amountMinor });
        }

        return toResult(payment!, false);
      });
    },

    async capture(paymentId: string, recheck: Recheck = noRecheck): Promise<PaymentResult> {
      const { mandateId } = await findPayment(db, paymentId);

      return db.transaction(async (tx) => {
        const balance = await lockBalance(tx, mandateId);
        const payment = await reloadPayment(tx, paymentId);

        if (payment.status === 'executed' && payment.kind === 'payment') {
          return toResult(payment, true);
        }
        if (payment.status !== 'held') {
          throw new InvalidStateError(`cannot capture a ${payment.status} ${payment.kind}`);
        }

        const reasons = await recheck({ tx, balance });
        if (reasons.length > 0) return { ...toResult(payment, false), reasons };

        const [captured] = await tx
          .update(payments)
          .set({ status: 'executed' })
          .where(eq(payments.id, paymentId))
          .returning();
        await adjustBalance(tx, mandateId, {
          spentMinor: payment.amountMinor,
          heldMinor: -payment.amountMinor,
        });
        await writeEntries(tx, captured!, payment.amountMinor);
        return toResult(captured!, false);
      });
    },

    async release(paymentId: string): Promise<PaymentResult> {
      const { mandateId } = await findPayment(db, paymentId);

      return db.transaction(async (tx) => {
        await lockBalance(tx, mandateId);
        const payment = await reloadPayment(tx, paymentId);

        if (payment.status === 'released') return toResult(payment, true);
        if (payment.status !== 'held') {
          throw new InvalidStateError(`cannot release a ${payment.status} payment`);
        }

        const [released] = await tx
          .update(payments)
          .set({ status: 'released' })
          .where(eq(payments.id, paymentId))
          .returning();
        await adjustBalance(tx, mandateId, { heldMinor: -payment.amountMinor });
        return toResult(released!, false);
      });
    },

    async reverse(input: ReverseInput): Promise<PaymentResult> {
      assertNonEmpty(input.idempotencyKey, 'idempotencyKey');
      const { mandateId } = await findPayment(db, input.paymentId);

      return db.transaction(async (tx) => {
        await lockBalance(tx, mandateId);

        const existing = await findByKey(tx, mandateId, input.idempotencyKey);
        if (existing) {
          if (existing.reversesPaymentId !== input.paymentId) {
            throw new IdempotencyConflictError(input.idempotencyKey);
          }
          return toResult(existing, true);
        }

        const original = await reloadPayment(tx, input.paymentId);
        if (original.status !== 'executed' || original.kind !== 'payment') {
          throw new InvalidStateError(`cannot reverse a ${original.status} ${original.kind}`);
        }
        const [priorReversal] = await tx
          .select()
          .from(payments)
          .where(eq(payments.reversesPaymentId, original.id));
        if (priorReversal) throw new InvalidStateError(`payment ${original.id} is already reversed`);

        const [reversal] = await tx
          .insert(payments)
          .values({
            mandateId,
            idempotencyKey: input.idempotencyKey,
            kind: 'reversal',
            reversesPaymentId: original.id,
            merchant: original.merchant,
            amountMinor: original.amountMinor,
            currency: original.currency,
            status: 'executed',
          })
          .returning();
        await adjustBalance(tx, mandateId, { spentMinor: -original.amountMinor });
        await writeEntries(tx, reversal!, -original.amountMinor);
        return toResult(reversal!, false);
      });
    },
  };
}

export type Ledger = ReturnType<typeof createLedger>;
