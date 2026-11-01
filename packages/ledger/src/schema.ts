import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
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

export const mandateStatus = pgEnum('mandate_status', ['active', 'paused', 'revoked']);

export const decisionOutcome = pgEnum('decision_outcome', [
  'APPROVE',
  'REJECT',
  'NEEDS_APPROVAL',
]);

export const auditActor = pgEnum('audit_actor', ['agent', 'policy', 'human', 'system']);

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
    index('payments_recent_idx').on(t.mandateId, t.merchant, t.createdAt),
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

/** What the user allowed. Budget and currency live on balances, so there is only one of each. */
export const mandates = pgTable(
  'mandates',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => balances.mandateId),
    perItemLimitMinor: bigint('per_item_limit_minor', { mode: 'number' }).notNull(),
    allowedMerchantCategories: text('allowed_merchant_categories').array().notNull(),
    blockedMerchants: text('blocked_merchants').array().notNull().default(sql`'{}'::text[]`),
    maxQuantityPerItem: integer('max_quantity_per_item').notNull(),
    approvalThresholdMinor: bigint('approval_threshold_minor', { mode: 'number' }).notNull(),
    splitWindowMinutes: integer('split_window_minutes').notNull().default(10),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: mandateStatus('status').notNull().default('active'),
    killSwitch: boolean('kill_switch').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('mandates_limits_positive', sql`${t.perItemLimitMinor} > 0 AND ${t.approvalThresholdMinor} > 0`),
    check('mandates_quantity_positive', sql`${t.maxQuantityPerItem} > 0`),
    check('mandates_window_non_negative', sql`${t.splitWindowMinutes} >= 0`),
  ],
);

/** The only source of a merchant's category. Anything not listed here is denied. */
export const merchants = pgTable('merchants', {
  name: text('name').primaryKey(),
  category: text('category').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Stored exactly as received, malformed or not, so amounts stay in the raw JSON. */
export const proposals = pgTable(
  'proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mandateId: uuid('mandate_id')
      .notNull()
      .references(() => mandates.id),
    idempotencyKey: text('idempotency_key').notNull(),
    reason: text('reason'),
    raw: jsonb('raw').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('proposals_mandate_key_idx').on(t.mandateId, t.idempotencyKey)],
);

export const decisions = pgTable(
  'decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id),
    outcome: decisionOutcome('outcome').notNull(),
    reasons: text('reasons').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('decisions_proposal_idx').on(t.proposalId)],
);

/** No foreign key on mandate_id: proposals for unknown mandates are logged here too. */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    actor: auditActor('actor').notNull(),
    mandateId: uuid('mandate_id'),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_events_mandate_created_idx').on(t.mandateId, t.createdAt)],
);
