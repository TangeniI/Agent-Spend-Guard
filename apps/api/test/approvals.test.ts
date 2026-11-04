import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { proposal, startApp, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(() => app.stop());

interface Pending {
  paymentId: string;
  mandateId: string;
  amountMinor: number;
  reasons: string[];
  agentReason: string | null;
  items: unknown[];
  balance: { heldMinor: number };
}

const bigItems = [{ sku: 'sku-4000', quantity: 2, unitPriceMinor: 4_000 }];

async function holdOne(overrides: Record<string, unknown> = {}) {
  const mandateId = await app.createMandate(overrides);
  const merchant = await app.registerMerchant();
  const response = await app.api(
    'POST',
    '/payments',
    proposal(mandateId, merchant, { amountMinor: 8_000, items: bigItems }),
  );
  const { paymentId, status } = (await response.json()) as { paymentId: string; status: string };
  expect(status).toBe('held');
  return { mandateId, paymentId };
}

async function pending(mandateId: string) {
  return (await (await app.api('GET', `/approvals?mandateId=${mandateId}`)).json()) as Pending[];
}

async function balance(mandateId: string) {
  const body = (await (await app.api('GET', `/mandates/${mandateId}`)).json()) as {
    balance: { spentMinor: number; heldMinor: number };
  };
  return body.balance;
}

async function auditTypes(mandateId: string) {
  const rows = (await (await app.api('GET', `/audit?mandateId=${mandateId}`)).json()) as {
    type: string;
  }[];
  return rows.map((r) => r.type);
}

describe('approval queue', () => {
  it('lists a held payment with why it was flagged and its budget impact', async () => {
    const { mandateId, paymentId } = await holdOne();

    const [entry] = await pending(mandateId);

    expect(entry).toMatchObject({
      paymentId,
      amountMinor: 8_000,
      reasons: ['OVER_APPROVAL_THRESHOLD'],
      agentReason: 'The user asked for a phone case.',
      items: bigItems,
      balance: { heldMinor: 8_000 },
    });
  });

  it('approval pays the hold once, and logs the human', async () => {
    const { mandateId, paymentId } = await holdOne();

    const first = await app.api('POST', `/approvals/${paymentId}/approve`);
    const again = await app.api('POST', `/approvals/${paymentId}/approve`);

    expect(await first.json()).toMatchObject({ status: 'executed', replayed: false });
    expect(await again.json()).toMatchObject({ status: 'executed', replayed: true });
    expect(await balance(mandateId)).toMatchObject({ spentMinor: 8_000, heldMinor: 0 });
    expect(await pending(mandateId)).toHaveLength(0);
    expect(await auditTypes(mandateId)).toContain('APPROVAL_GRANTED');
  });

  it('rejection releases the budget', async () => {
    const { mandateId, paymentId } = await holdOne();

    const response = await app.api('POST', `/approvals/${paymentId}/reject`);

    expect(await response.json()).toMatchObject({ status: 'released' });
    expect(await balance(mandateId)).toMatchObject({ spentMinor: 0, heldMinor: 0 });
    expect(await auditTypes(mandateId)).toContain('APPROVAL_REJECTED');
  });

  it.each([
    ['the kill switch is on', { killSwitch: true }, 'KILL_SWITCH_ON'],
    ['the mandate is paused', { status: 'paused' }, 'MANDATE_NOT_ACTIVE'],
  ])('re-checks at approval: blocked when %s', async (_name, change, reason) => {
    const { mandateId, paymentId } = await holdOne();
    await app.api('PATCH', `/mandates/${mandateId}`, change);

    const response = await app.api('POST', `/approvals/${paymentId}/approve`);

    expect(await response.json()).toMatchObject({ status: 'held', reasons: [reason] });
    expect(await balance(mandateId)).toMatchObject({ spentMinor: 0, heldMinor: 8_000 });
    expect(await auditTypes(mandateId)).toContain('APPROVAL_BLOCKED');
  });

  it('re-checks expiry at approval', async () => {
    const expiresAt = new Date(Date.now() + 1_500).toISOString();
    const { paymentId } = await holdOne({ expiresAt });
    await new Promise((resolve) => setTimeout(resolve, 1_600));

    const response = await app.api('POST', `/approvals/${paymentId}/approve`);

    expect(await response.json()).toMatchObject({ status: 'held', reasons: ['MANDATE_EXPIRED'] });
  });

  it('cannot reject a payment that has already executed', async () => {
    const { paymentId } = await holdOne();
    await app.api('POST', `/approvals/${paymentId}/approve`);
    expect((await app.api('POST', `/approvals/${paymentId}/reject`)).status).toBe(409);
  });

  it('returns 404 for an unknown payment and 400 for a bad id', async () => {
    expect((await app.api('POST', `/approvals/${randomUUID()}/approve`)).status).toBe(404);
    expect((await app.api('POST', '/approvals/nope/reject')).status).toBe(400);
    expect((await app.api('GET', '/approvals?mandateId=nope')).status).toBe(400);
  });

  it('requires the service token', async () => {
    expect((await app.api('GET', '/approvals', undefined, null)).status).toBe(401);
    const { paymentId } = await holdOne();
    expect((await app.api('POST', `/approvals/${paymentId}/approve`, undefined, null)).status).toBe(
      401,
    );
  });
});

describe('audit log', () => {
  it('returns events newest first and filters them', async () => {
    const { mandateId } = await holdOne();

    const all = (await (await app.api('GET', `/audit?mandateId=${mandateId}`)).json()) as {
      type: string;
      actor: string;
      createdAt: string;
    }[];
    const times = all.map((e) => Date.parse(e.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));

    const policy = (await (
      await app.api('GET', `/audit?mandateId=${mandateId}&actor=policy`)
    ).json()) as { actor: string }[];
    expect(policy.length).toBeGreaterThan(0);
    expect(policy.every((e) => e.actor === 'policy')).toBe(true);

    const decisions = (await (
      await app.api('GET', `/audit?mandateId=${mandateId}&type=DECISION_MADE&limit=1`)
    ).json()) as { type: string }[];
    expect(decisions).toEqual([expect.objectContaining({ type: 'DECISION_MADE' })]);
  });

  it.each([
    ['a bad actor', 'actor=robot'],
    ['a bad limit', 'limit=0'],
    ['too high a limit', 'limit=501'],
    ['a bad mandate id', 'mandateId=nope'],
  ])('refuses %s', async (_name, query) => {
    expect((await app.api('GET', `/audit?${query}`)).status).toBe(400);
  });
});

describe('lists', () => {
  it('lists mandates with their balances, newest first', async () => {
    const id = await app.createMandate();
    const list = (await (await app.api('GET', '/mandates')).json()) as {
      id: string;
      balance: object;
    }[];
    expect(list[0]).toMatchObject({ id, balance: expect.any(Object) });
  });

  it('refuses a bad mandate id when listing runs', async () => {
    expect((await app.api('GET', '/runs?mandateId=nope')).status).toBe(400);
  });
});
