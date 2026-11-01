import { Inject, Injectable } from '@nestjs/common';
import {
  assertNonEmpty,
  assertUuid,
  auditEvents,
  balances,
  decisions,
  IdempotencyConflictError,
  mandates,
  merchants,
  payments,
  proposals,
  UnknownMandateError,
  type Balance,
  type Ledger,
  type LedgerDb,
  type LedgerTx,
  type PaymentStatus,
} from '@asg/ledger';
import {
  evaluate,
  type Decision,
  type LineItem,
  type Mandate,
  type Proposal,
} from '@asg/policy';
import { and, eq, gt, inArray } from 'drizzle-orm';
import { DB, LEDGER, type DbHandle } from '../database/database.module.js';

export interface GuardResult {
  paymentId: string | null;
  status: PaymentStatus;
  reasons: string[];
  replayed: boolean;
}

type Raw = Record<string, unknown>;

const LEDGER_ACTION = { APPROVE: 'execute', NEEDS_APPROVAL: 'hold', REJECT: 'reject' } as const;

const MINUTE_MS = 60_000;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const stringOr = (value: unknown, fallback: string) =>
  typeof value === 'string' ? value : fallback;

const numberOrNaN = (value: unknown) => (typeof value === 'number' ? value : Number.NaN);

function toItem(value: unknown): LineItem {
  const item = isRecord(value) ? value : {};
  return {
    name: stringOr(item.name, ''),
    quantity: numberOrNaN(item.quantity),
    unitPriceMinor: numberOrNaN(item.unitPriceMinor),
  };
}

/** Reads only the structured fields. `reason` is deliberately left behind. */
function toProposal(raw: Raw): Proposal {
  return {
    merchant: stringOr(raw.merchant, ''),
    amountMinor: numberOrNaN(raw.amountMinor),
    currency: stringOr(raw.currency, ''),
    items: Array.isArray(raw.items) ? raw.items.map(toItem) : [],
  };
}

/** A proposal the ledger can store. Anything else is rejected without reaching it. */
function fitsLedger(proposal: Proposal) {
  return (
    Number.isSafeInteger(proposal.amountMinor) &&
    proposal.amountMinor > 0 &&
    proposal.merchant.length > 0 &&
    /^[A-Z]{3}$/.test(proposal.currency)
  );
}

@Injectable()
export class GuardService {
  private readonly db: LedgerDb;

  constructor(
    @Inject(DB) handle: DbHandle,
    @Inject(LEDGER) private readonly ledger: Ledger,
  ) {
    this.db = handle.db;
  }

  async propose(body: unknown): Promise<GuardResult> {
    const raw = isRecord(body) ? body : {};
    assertUuid(raw.mandateId, 'mandateId');
    assertNonEmpty(raw.idempotencyKey, 'idempotencyKey');
    const mandateId = raw.mandateId as string;
    const idempotencyKey = raw.idempotencyKey as string;
    const proposal = toProposal(raw);

    try {
      return fitsLedger(proposal)
        ? await this.throughLedger(mandateId, idempotencyKey, proposal, raw)
        : await this.rejectMalformed(mandateId, idempotencyKey, proposal, raw);
    } catch (error) {
      if (error instanceof UnknownMandateError) {
        await this.audit(this.db, 'PROPOSAL_UNKNOWN_MANDATE', 'system', mandateId, raw);
      } else if (error instanceof IdempotencyConflictError) {
        await this.audit(this.db, 'IDEMPOTENCY_CONFLICT', 'system', mandateId, raw);
      }
      throw error;
    }
  }

  private async throughLedger(
    mandateId: string,
    idempotencyKey: string,
    proposal: Proposal,
    raw: Raw,
  ) {
    const result = await this.ledger.submit(
      {
        mandateId,
        idempotencyKey,
        merchant: proposal.merchant,
        amountMinor: proposal.amountMinor,
        currency: proposal.currency,
      },
      async ({ tx, balance }) => {
        const decision = await this.decide(tx, balance, proposal);
        await this.record(tx, mandateId, idempotencyKey, raw, decision);
        return { action: LEDGER_ACTION[decision.outcome], reasons: decision.reasons };
      },
    );

    if (result.replayed) {
      await this.audit(this.db, 'PROPOSAL_REPLAYED', 'system', mandateId, {
        idempotencyKey,
        paymentId: result.paymentId,
      });
    }
    return result;
  }

  /** Moves no money, so it needs no lock. It must still be logged. */
  private rejectMalformed(
    mandateId: string,
    idempotencyKey: string,
    proposal: Proposal,
    raw: Raw,
  ) {
    return this.db.transaction(async (tx): Promise<GuardResult> => {
      const [balance] = await tx.select().from(balances).where(eq(balances.mandateId, mandateId));
      if (!balance) throw new UnknownMandateError(mandateId);

      const decision = await this.decide(tx, balance, proposal);
      await this.record(tx, mandateId, idempotencyKey, raw, decision);
      return { paymentId: null, status: 'rejected', reasons: decision.reasons, replayed: false };
    });
  }

  private async decide(tx: LedgerTx, balance: Balance, proposal: Proposal): Promise<Decision> {
    const [mandate] = await tx.select().from(mandates).where(eq(mandates.id, balance.mandateId));
    if (!mandate) throw new UnknownMandateError(balance.mandateId);

    const [merchant] = await tx
      .select()
      .from(merchants)
      .where(eq(merchants.name, proposal.merchant));

    const now = new Date();
    const recent = await tx
      .select({ amountMinor: payments.amountMinor, at: payments.createdAt })
      .from(payments)
      .where(
        and(
          eq(payments.mandateId, balance.mandateId),
          eq(payments.merchant, proposal.merchant),
          eq(payments.kind, 'payment'),
          inArray(payments.status, ['executed', 'held']),
          gt(payments.createdAt, new Date(now.getTime() - mandate.splitWindowMinutes * MINUTE_MS)),
        ),
      );

    const policyMandate: Mandate = {
      ...mandate,
      currency: balance.currency,
      budgetMinor: balance.budgetMinor,
    };
    return evaluate(proposal, policyMandate, {
      now,
      merchantCategory: merchant?.category ?? null,
      spentMinor: balance.spentMinor,
      heldMinor: balance.heldMinor,
      recentToMerchant: recent,
    });
  }

  private async record(
    tx: LedgerTx,
    mandateId: string,
    idempotencyKey: string,
    raw: Raw,
    decision: Decision,
  ) {
    const reason = typeof raw.reason === 'string' ? raw.reason : null;
    const [proposal] = await tx
      .insert(proposals)
      .values({ mandateId, idempotencyKey, reason, raw })
      .returning({ id: proposals.id });
    const proposalId = proposal!.id;

    await tx.insert(decisions).values({ proposalId, ...decision });
    await this.audit(tx, 'PROPOSAL_RECEIVED', 'agent', mandateId, { proposalId, raw });
    await this.audit(tx, 'DECISION_MADE', 'policy', mandateId, { proposalId, ...decision });
  }

  private async audit(
    client: LedgerDb | LedgerTx,
    type: string,
    actor: 'agent' | 'policy' | 'system',
    mandateId: string,
    payload: object,
  ) {
    await client.insert(auditEvents).values({ type, actor, mandateId, payload });
  }
}
