import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  createLedger,
  IdempotencyConflictError,
  InvalidRequestError,
  InvalidStateError,
  ledgerEntries,
  migrate,
  payments,
  UnknownMandateError,
  UnknownPaymentError,
  type Ledger,
  type LedgerDb,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/testing.js';

let testDb: TestDatabase;
let db: LedgerDb;
let closeDb: () => Promise<void>;
let ledger: Ledger;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const handle = createDb(testDb.url, { max: 20 });
  db = handle.db;
  closeDb = handle.close;
  await migrate(db);
  ledger = createLedger(db);
});

afterAll(async () => {
  await closeDb();
  await testDb.drop();
});

async function openMandate(budgetMinor = 10_000, currency = 'GBP') {
  const mandateId = randomUUID();
  await ledger.openBalance({ mandateId, currency, budgetMinor });
  return mandateId;
}

function request(mandateId: string, overrides: Record<string, unknown> = {}) {
  return {
    mandateId,
    idempotencyKey: randomUUID(),
    merchant: 'shop.example',
    amountMinor: 1_000,
    currency: 'GBP',
    ...overrides,
  } as Parameters<Ledger['submit']>[0];
}

function entriesFor(paymentId: string) {
  return db.select().from(ledgerEntries).where(eq(ledgerEntries.paymentId, paymentId));
}

async function pgErrorCode(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    const { code, cause } = error as { code?: string; cause?: { code?: string } };
    return code ?? cause?.code;
  }
  return undefined;
}

describe('submit', () => {
  it('executes a payment with balanced entries and updates the balance', async () => {
    const mandateId = await openMandate();
    const result = await ledger.submit(request(mandateId, { amountMinor: 1_250 }));

    expect(result).toMatchObject({ status: 'executed', reasons: [], replayed: false });
    expect(await ledger.getBalance(mandateId)).toMatchObject({ spentMinor: 1_250, heldMinor: 0 });

    const entries = await entriesFor(result.paymentId);
    expect(entries).toHaveLength(2);
    expect(entries.reduce((sum, entry) => sum + entry.amountMinor, 0)).toBe(0);
    expect(entries.map((e) => [e.account, e.amountMinor]).sort()).toEqual(
      [
        [`mandate:${mandateId}`, -1_250],
        ['merchant:shop.example', 1_250],
      ].sort(),
    );
  });

  it('returns the original result for a repeated key and never pays twice', async () => {
    const mandateId = await openMandate();
    const input = request(mandateId);

    const first = await ledger.submit(input);
    const second = await ledger.submit(input);

    expect(second).toEqual({ ...first, replayed: true });
    expect((await ledger.getBalance(mandateId)).spentMinor).toBe(1_000);
    expect(await entriesFor(first.paymentId)).toHaveLength(2);
  });

  it.each([
    ['amount', { amountMinor: 1_001 }],
    ['merchant', { merchant: 'other.example' }],
    ['currency', { currency: 'USD' }],
  ])('refuses a repeated key with a different %s', async (_field, change) => {
    const mandateId = await openMandate();
    const input = request(mandateId);
    await ledger.submit(input);

    await expect(ledger.submit({ ...input, ...change })).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
    expect((await ledger.getBalance(mandateId)).spentMinor).toBe(1_000);
  });

  it('scopes idempotency keys to a mandate', async () => {
    const [a, b] = [await openMandate(), await openMandate()];
    const idempotencyKey = randomUUID();

    await ledger.submit(request(a, { idempotencyKey }));
    const other = await ledger.submit(request(b, { idempotencyKey }));

    expect(other).toMatchObject({ status: 'executed', replayed: false });
  });

  it('allows a payment that exactly exhausts the budget', async () => {
    const mandateId = await openMandate(1_000);
    expect((await ledger.submit(request(mandateId))).status).toBe('executed');
  });

  it('rejects a payment over budget, records it and moves no money', async () => {
    const mandateId = await openMandate(999);
    const result = await ledger.submit(request(mandateId));

    expect(result).toMatchObject({ status: 'rejected', reasons: ['BUDGET_EXCEEDED'] });
    expect(await entriesFor(result.paymentId)).toHaveLength(0);
    expect((await ledger.getBalance(mandateId)).spentMinor).toBe(0);
  });

  it('replays a rejection even after budget has been freed', async () => {
    const mandateId = await openMandate(1_500);
    const paid = await ledger.submit(request(mandateId));
    const input = request(mandateId);
    expect((await ledger.submit(input)).status).toBe('rejected');

    await ledger.reverse({ paymentId: paid.paymentId, idempotencyKey: randomUUID() });

    expect(await ledger.submit(input)).toMatchObject({
      status: 'rejected',
      reasons: ['BUDGET_EXCEEDED'],
      replayed: true,
    });
  });

  it('rejects a currency that does not match the balance', async () => {
    const mandateId = await openMandate();
    const result = await ledger.submit(request(mandateId, { currency: 'USD' }));

    expect(result).toMatchObject({ status: 'rejected', reasons: ['CURRENCY_MISMATCH'] });
    expect((await ledger.getBalance(mandateId)).spentMinor).toBe(0);
  });

  it.each([
    ['a float', { amountMinor: 10.5 }],
    ['zero', { amountMinor: 0 }],
    ['a negative', { amountMinor: -100 }],
    ['an unsafe integer', { amountMinor: Number.MAX_SAFE_INTEGER + 1 }],
    ['NaN', { amountMinor: Number.NaN }],
    ['a numeric string', { amountMinor: '100' }],
    ['an empty key', { idempotencyKey: '' }],
    ['an empty merchant', { merchant: '' }],
    ['a malformed currency', { currency: 'gbp' }],
  ])('refuses %s without touching the database', async (_name, change) => {
    const mandateId = await openMandate();

    await expect(ledger.submit(request(mandateId, change))).rejects.toBeInstanceOf(
      InvalidRequestError,
    );
    const rows = await db.select().from(payments).where(eq(payments.mandateId, mandateId));
    expect(rows).toHaveLength(0);
  });

  it('throws for an unknown mandate', async () => {
    await expect(ledger.submit(request(randomUUID()))).rejects.toBeInstanceOf(UnknownMandateError);
  });
});

describe('decide callback', () => {
  it('can reject, and the rejection is stored and replayed', async () => {
    const mandateId = await openMandate();
    const input = request(mandateId);
    const decide = () => ({ action: 'reject' as const, reasons: ['KILL_SWITCH_ON'] });

    const first = await ledger.submit(input, decide);
    const replay = await ledger.submit(input);

    expect(first).toMatchObject({ status: 'rejected', reasons: ['KILL_SWITCH_ON'] });
    expect(replay).toEqual({ ...first, replayed: true });
    expect((await ledger.getBalance(mandateId)).spentMinor).toBe(0);
  });

  it('can hold, which reserves budget and writes no entries', async () => {
    const mandateId = await openMandate(1_500);
    const held = await ledger.submit(request(mandateId), () => ({
      action: 'hold',
      reasons: ['OVER_APPROVAL_THRESHOLD'],
    }));

    expect(held).toMatchObject({ status: 'held', reasons: ['OVER_APPROVAL_THRESHOLD'] });
    expect(await ledger.getBalance(mandateId)).toMatchObject({ spentMinor: 0, heldMinor: 1_000 });
    expect(await entriesFor(held.paymentId)).toHaveLength(0);

    const next = await ledger.submit(request(mandateId));
    expect(next).toMatchObject({ status: 'rejected', reasons: ['BUDGET_EXCEEDED'] });
  });

  it('cannot hold more than the budget', async () => {
    const mandateId = await openMandate(999);
    const result = await ledger.submit(request(mandateId), () => ({
      action: 'hold',
      reasons: [],
    }));
    expect(result).toMatchObject({ status: 'rejected', reasons: ['BUDGET_EXCEEDED'] });
  });

  it('still runs on a currency mismatch, so the decision can be logged', async () => {
    const mandateId = await openMandate();
    let calls = 0;

    const result = await ledger.submit(request(mandateId, { currency: 'USD' }), () => {
      calls += 1;
      return { action: 'execute', reasons: [] };
    });

    expect(calls).toBe(1);
    expect(result).toMatchObject({ status: 'rejected', reasons: ['CURRENCY_MISMATCH'] });
    expect((await ledger.getBalance(mandateId)).spentMinor).toBe(0);
  });

  it('is not called for a replay', async () => {
    const mandateId = await openMandate();
    const input = request(mandateId);
    await ledger.submit(input);

    let calls = 0;
    await ledger.submit(input, () => {
      calls += 1;
      return { action: 'execute', reasons: [] };
    });
    expect(calls).toBe(0);
  });

  it('runs while the balance row is locked', async () => {
    const mandateId = await openMandate();
    let lockError: string | undefined;

    await ledger.submit(request(mandateId), async ({ balance }) => {
      lockError = await pgErrorCode(() =>
        db.execute(
          sql`SELECT 1 FROM balances WHERE mandate_id = ${balance.mandateId} FOR UPDATE NOWAIT`,
        ),
      );
      return { action: 'execute', reasons: [] };
    });

    expect(lockError).toBe('55P03'); // lock_not_available
  });

  it('sees earlier concurrent payments, so split checks cannot race', async () => {
    const mandateId = await openMandate();

    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        ledger.submit(request(mandateId, { amountMinor: 10 }), async ({ tx }) => {
          const prior = await tx
            .select()
            .from(payments)
            .where(eq(payments.mandateId, mandateId));
          return prior.length < 3
            ? { action: 'execute', reasons: [] }
            : { action: 'reject', reasons: ['SPLIT_PURCHASE_SUSPECTED'] };
        }),
      ),
    );

    expect(results.filter((r) => r.status === 'executed')).toHaveLength(3);
    expect((await ledger.getBalance(mandateId)).spentMinor).toBe(30);
  });

  it('rolls everything back if it throws', async () => {
    const mandateId = await openMandate();
    const input = request(mandateId);

    await expect(
      ledger.submit(input, () => {
        throw new Error('policy exploded');
      }),
    ).rejects.toThrow('policy exploded');

    expect((await ledger.submit(input)).replayed).toBe(false);
  });
});

describe('capture and release', () => {
  const holdIt = () => ({ action: 'hold' as const, reasons: ['NEEDS_APPROVAL'] });

  it('capture moves a hold into spent with balanced entries', async () => {
    const mandateId = await openMandate();
    const held = await ledger.submit(request(mandateId), holdIt);

    const captured = await ledger.capture(held.paymentId);

    expect(captured).toMatchObject({ status: 'executed', replayed: false });
    expect(await ledger.getBalance(mandateId)).toMatchObject({ spentMinor: 1_000, heldMinor: 0 });
    expect(await entriesFor(held.paymentId)).toHaveLength(2);
  });

  it('capture twice pays once', async () => {
    const mandateId = await openMandate();
    const held = await ledger.submit(request(mandateId), holdIt);

    await ledger.capture(held.paymentId);
    const again = await ledger.capture(held.paymentId);

    expect(again).toMatchObject({ status: 'executed', replayed: true });
    expect((await ledger.getBalance(mandateId)).spentMinor).toBe(1_000);
    expect(await entriesFor(held.paymentId)).toHaveLength(2);
  });

  it('a failed re-check at approval leaves the hold in place', async () => {
    const mandateId = await openMandate();
    const held = await ledger.submit(request(mandateId), holdIt);

    const result = await ledger.capture(held.paymentId, () => ['KILL_SWITCH_ON']);

    expect(result).toMatchObject({ status: 'held', reasons: ['KILL_SWITCH_ON'], replayed: false });
    expect(await ledger.getBalance(mandateId)).toMatchObject({ spentMinor: 0, heldMinor: 1_000 });
    expect(await entriesFor(held.paymentId)).toHaveLength(0);
  });

  it('release frees the budget and is idempotent', async () => {
    const mandateId = await openMandate();
    const held = await ledger.submit(request(mandateId), holdIt);

    expect(await ledger.release(held.paymentId)).toMatchObject({
      status: 'released',
      replayed: false,
    });
    expect(await ledger.release(held.paymentId)).toMatchObject({
      status: 'released',
      replayed: true,
    });
    expect((await ledger.getBalance(mandateId)).heldMinor).toBe(0);
  });

  it('refuses to capture a released hold or a rejected payment', async () => {
    const mandateId = await openMandate(1_000);
    const held = await ledger.submit(request(mandateId), holdIt);
    const rejected = await ledger.submit(request(mandateId));
    await ledger.release(held.paymentId);

    await expect(ledger.capture(held.paymentId)).rejects.toBeInstanceOf(InvalidStateError);
    await expect(ledger.capture(rejected.paymentId)).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('refuses to release an executed payment', async () => {
    const mandateId = await openMandate();
    const paid = await ledger.submit(request(mandateId));

    await expect(ledger.release(paid.paymentId)).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('throws for an unknown payment', async () => {
    await expect(ledger.capture(randomUUID())).rejects.toBeInstanceOf(UnknownPaymentError);
    await expect(ledger.release(randomUUID())).rejects.toBeInstanceOf(UnknownPaymentError);
  });

  it('racing capture and release have exactly one winner', async () => {
    const mandateId = await openMandate();
    const held = await ledger.submit(request(mandateId), holdIt);

    const outcomes = await Promise.allSettled([
      ledger.capture(held.paymentId),
      ledger.release(held.paymentId),
    ]);

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const balance = await ledger.getBalance(mandateId);
    expect(balance.heldMinor).toBe(0);
    expect([0, 1_000]).toContain(balance.spentMinor);
  });
});

describe('reverse', () => {
  it('writes opposite entries and restores the budget', async () => {
    const mandateId = await openMandate();
    const paid = await ledger.submit(request(mandateId));

    const reversal = await ledger.reverse({
      paymentId: paid.paymentId,
      idempotencyKey: randomUUID(),
    });

    expect(reversal).toMatchObject({ status: 'executed', replayed: false });
    expect((await ledger.getBalance(mandateId)).spentMinor).toBe(0);
    expect(await entriesFor(paid.paymentId)).toHaveLength(2);
    expect((await entriesFor(reversal.paymentId)).map((e) => [e.account, e.amountMinor]).sort()).toEqual(
      [
        [`mandate:${mandateId}`, 1_000],
        ['merchant:shop.example', -1_000],
      ].sort(),
    );
  });

  it('replays by key and never reverses twice', async () => {
    const mandateId = await openMandate();
    const paid = await ledger.submit(request(mandateId));
    const input = { paymentId: paid.paymentId, idempotencyKey: randomUUID() };

    const first = await ledger.reverse(input);
    expect(await ledger.reverse(input)).toEqual({ ...first, replayed: true });

    await expect(
      ledger.reverse({ paymentId: paid.paymentId, idempotencyKey: randomUUID() }),
    ).rejects.toBeInstanceOf(InvalidStateError);
    expect((await ledger.getBalance(mandateId)).spentMinor).toBe(0);
  });

  it('refuses to reuse a payment key for a reversal', async () => {
    const mandateId = await openMandate();
    const input = request(mandateId);
    const paid = await ledger.submit(input);

    await expect(
      ledger.reverse({ paymentId: paid.paymentId, idempotencyKey: input.idempotencyKey }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('only reverses executed payments', async () => {
    const mandateId = await openMandate(1_000);
    const held = await ledger.submit(request(mandateId), () => ({ action: 'hold', reasons: [] }));
    const paid = await ledger.submit(request(mandateId, { amountMinor: 1 }));
    const reversal = await ledger.reverse({
      paymentId: (await ledger.capture(held.paymentId)).paymentId,
      idempotencyKey: randomUUID(),
    });

    await expect(
      ledger.reverse({ paymentId: paid.paymentId, idempotencyKey: randomUUID() }),
    ).rejects.toBeInstanceOf(InvalidStateError);
    await expect(
      ledger.reverse({ paymentId: reversal.paymentId, idempotencyKey: randomUUID() }),
    ).rejects.toBeInstanceOf(InvalidStateError);
    await expect(
      ledger.reverse({ paymentId: randomUUID(), idempotencyKey: randomUUID() }),
    ).rejects.toBeInstanceOf(UnknownPaymentError);
    await expect(
      ledger.reverse({ paymentId: held.paymentId, idempotencyKey: '' }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
  });
});

describe('database guards', () => {
  it('blocks updating, deleting and truncating ledger entries', async () => {
    const mandateId = await openMandate();
    const { paymentId } = await ledger.submit(request(mandateId));

    await expect(
      db.update(ledgerEntries).set({ amountMinor: 1 }).where(eq(ledgerEntries.paymentId, paymentId)),
    ).rejects.toThrow();
    await expect(
      db.delete(ledgerEntries).where(eq(ledgerEntries.paymentId, paymentId)),
    ).rejects.toThrow();
    await expect(db.execute(sql`TRUNCATE ledger_entries`)).rejects.toThrow();
    expect(await entriesFor(paymentId)).toHaveLength(2);
  });

  it('blocks committing unbalanced entries', async () => {
    const mandateId = await openMandate();
    const { paymentId } = await ledger.submit(request(mandateId));

    await expect(
      db.insert(ledgerEntries).values({
        paymentId,
        account: 'merchant:shop.example',
        amountMinor: 5,
        currency: 'GBP',
      }),
    ).rejects.toThrow();
    expect(await entriesFor(paymentId)).toHaveLength(2);
  });

  it('blocks a second row for the same key at the database level', async () => {
    const mandateId = await openMandate();
    const input = request(mandateId);
    await ledger.submit(input);

    const code = await pgErrorCode(() =>
      db.insert(payments).values({ ...input, amountMinor: 1_000, status: 'executed' }),
    );
    expect(code).toBe('23505'); // unique_violation
  });

  it('blocks a direct write that would overspend', async () => {
    const mandateId = await openMandate(100);

    const code = await pgErrorCode(() =>
      db.execute(sql`UPDATE balances SET spent_minor = 101 WHERE mandate_id = ${mandateId}`),
    );
    expect(code).toBe('23514'); // check_violation
  });
});

describe('concurrency', () => {
  it('never double charges or overspends under concurrent load with retries', async () => {
    const amounts = Array.from({ length: 150 }, (_, i) => 50 + (i % 7) * 10);
    const demand = amounts.reduce((sum, amount) => sum + amount, 0);
    const budgetMinor = Math.floor(demand / 2);
    const mandateId = await openMandate(budgetMinor);

    const unique = amounts.map((amountMinor, i) =>
      request(mandateId, { amountMinor, merchant: `merchant-${i % 25}.example` }),
    );
    const retries = unique.slice(0, 50);
    const shuffled = [...unique, ...retries].sort(() => Math.random() - 0.5);

    const results = await Promise.all(shuffled.map((input) => ledger.submit(input)));

    const rows = await db.select().from(payments).where(eq(payments.mandateId, mandateId));
    const executed = rows.filter((row) => row.status === 'executed');
    const spent = executed.reduce((sum, row) => sum + row.amountMinor, 0);
    const balance = await ledger.getBalance(mandateId);

    expect(rows).toHaveLength(unique.length);
    expect(results.filter((r) => r.replayed)).toHaveLength(retries.length);
    expect(executed.length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.status === 'rejected').length).toBeGreaterThan(0);
    expect(balance.spentMinor).toBe(spent);
    expect(balance.spentMinor).toBeLessThanOrEqual(budgetMinor);

    const [{ total } = { total: 'missing' }] = await db
      .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountMinor}), 0)` })
      .from(ledgerEntries)
      .innerJoin(payments, eq(ledgerEntries.paymentId, payments.id))
      .where(eq(payments.mandateId, mandateId));
    expect(Number(total)).toBe(0);
  });
});
