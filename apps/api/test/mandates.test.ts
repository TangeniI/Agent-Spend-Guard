import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(() => app.stop());

const valid = {
  currency: 'GBP',
  budgetMinor: 10_000,
  perItemLimitMinor: 1_000,
  allowedMerchantCategories: ['accessories'],
  maxQuantityPerItem: 1,
  approvalThresholdMinor: 500,
  expiresAt: '2099-01-01T00:00:00Z',
};

describe('mandates', () => {
  it('creates a mandate and its balance together', async () => {
    const response = await app.api('POST', '/mandates', valid);
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };

    const fetched = await (await app.api('GET', `/mandates/${id}`)).json();

    expect(fetched).toMatchObject({
      perItemLimitMinor: 1_000,
      splitWindowMinutes: 10,
      status: 'active',
      killSwitch: false,
      balance: { currency: 'GBP', budgetMinor: 10_000, spentMinor: 0, heldMinor: 0 },
    });
  });

  it.each([
    ['a float budget', { budgetMinor: 10.5 }],
    ['a float limit', { perItemLimitMinor: 1.5 }],
    ['a zero threshold', { approvalThresholdMinor: 0 }],
    ['a zero quantity', { maxQuantityPerItem: 0 }],
    ['an oversized quantity', { maxQuantityPerItem: 2 ** 40 }],
    ['an oversized split window', { splitWindowMinutes: 2 ** 40 }],
    ['a bad currency', { currency: 'pounds' }],
    ['bad categories', { allowedMerchantCategories: 'accessories' }],
    ['bad blocked merchants', { blockedMerchants: [1] }],
    ['a bad expiry', { expiresAt: 'soon' }],
    ['a missing expiry', { expiresAt: undefined }],
    ['a bad split window', { splitWindowMinutes: -1 }],
    ['a float split window', { splitWindowMinutes: 1.5 }],
  ])('refuses %s', async (_name, change) => {
    const response = await app.api('POST', '/mandates', { ...valid, ...change });
    expect(response.status).toBe(400);
  });

  it('leaves no balance behind when creation fails', async () => {
    const before = await app.db.execute('select count(*)::int as n from balances');
    // A valid date Postgres can't store, so this fails after the balance row is written.
    const response = await app.api('POST', '/mandates', {
      ...valid,
      expiresAt: '-004800-01-01T00:00:00Z',
    });
    expect(response.status).toBe(500);
    const after = await app.db.execute('select count(*)::int as n from balances');
    expect(after.rows).toEqual(before.rows);
  });

  it('updates status and kill switch', async () => {
    const id = await app.createMandate();

    const response = await app.api('PATCH', `/mandates/${id}`, {
      status: 'paused',
      killSwitch: true,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'paused', killSwitch: true });
  });

  it('leaves unspecified fields alone on update', async () => {
    const id = await app.createMandate();
    await app.api('PATCH', `/mandates/${id}`, { killSwitch: true });

    const response = await app.api('PATCH', `/mandates/${id}`, { status: 'paused' });

    expect(await response.json()).toMatchObject({ status: 'paused', killSwitch: true });
  });

  it.each([
    ['a bad status', { status: 'deleted' }],
    ['a non-boolean kill switch', { killSwitch: 'yes' }],
    ['an empty update', {}],
  ])('refuses %s', async (_name, body) => {
    const id = await app.createMandate();
    expect((await app.api('PATCH', `/mandates/${id}`, body)).status).toBe(400);
  });

  it('returns 404 for an unknown mandate', async () => {
    const id = randomUUID();
    expect((await app.api('GET', `/mandates/${id}`)).status).toBe(404);
    expect((await app.api('PATCH', `/mandates/${id}`, { killSwitch: true })).status).toBe(404);
  });

  it('returns 400 for a malformed id', async () => {
    expect((await app.api('GET', '/mandates/nope')).status).toBe(400);
  });

  it('requires the service token', async () => {
    expect((await app.api('POST', '/mandates', valid, null)).status).toBe(401);
    expect((await app.api('POST', '/merchants', {}, null)).status).toBe(401);
  });
});

describe('merchants', () => {
  it('registers and lists a merchant', async () => {
    const name = await app.registerMerchant();
    const list = (await (await app.api('GET', '/merchants')).json()) as { name: string }[];
    expect(list.map((m) => m.name)).toContain(name);
  });

  it('refuses a duplicate, so a category cannot be overwritten', async () => {
    const name = await app.registerMerchant();
    const response = await app.api('POST', '/merchants', { name, category: 'jewellery' });
    expect(response.status).toBe(409);
  });

  it.each([
    ['a missing name', { category: 'x' }],
    ['a missing category', { name: 'x' }],
  ])('refuses %s', async (_name, body) => {
    expect((await app.api('POST', '/merchants', body)).status).toBe(400);
  });
});
