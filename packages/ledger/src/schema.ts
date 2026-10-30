import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const paymentStatus = pgEnum('payment_status', [
  'executed',
  'rejected',
  'held',
  'released',
]);

export const paymentKind = pgEnum('payment_kind', ['payment', 'reversal']);

/** One row per mandate. Every money decision locks this row first. */
export const balances = pgTable(
  'balances',
  {
    mandateId: uuid('mandate_id').primaryKey(),
    currency: text('currency').notNull(),
    budgetMinor: bigint('budget_minor', { mode: 'number' }).notNull(),
    spentMinor: bigint('spent_minor', { mode: 'number' }).notNull().default(0),
    heldMinor: bigint('held_minor', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('balances_non_negative', sql`${t.spentMinor} >= 0 AND ${t.heldMinor} >= 0`),
    check('balances_within_budget', sql`${t.spentMinor} + ${t.heldMinor} <= ${t.budgetMinor}`),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mandateId: uuid('mandate_id')
      .notNull()
      .references(() => balances.mandateId),
    idempotencyKey: text('idempotency_key').notNull(),
    kind: paymentKind('kind').notNull().default('payment'),
    reversesPaymentId: uuid('reverses_payment_id'),
    merchant: text('merchant').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    status: paymentStatus('status').notNull(),
    reasons: text('reasons').array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('payments_mandate_key_unique').on(t.mandateId, t.idempotencyKey),
    uniqueIndex('payments_reverses_unique').on(t.reversesPaymentId),
    check('payments_amount_positive', sql`${t.amountMinor} > 0`),
  ],
);

/** Append-only. Signed amounts: debits positive, credits negative, each payment sums to zero. */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    account: text('account').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ledger_entries_payment_idx').on(t.paymentId),
    check('ledger_entries_amount_non_zero', sql`${t.amountMinor} <> 0`),
  ],
);
