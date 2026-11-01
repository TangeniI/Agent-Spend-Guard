import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { proposal, startApp, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(() => app.stop());

const post = (body: unknown) => app.api('POST', '/payments', body);

async function spent(mandateId: string) {
  const response = await app.api('GET', `/mandates/${mandateId}`);
  const { balance } = (await response.json()) as { balance: { spentMinor: number } };
  return balance.spentMinor;
}

describe('GET /health', () => {
  it('is open and reports ok', async () => {
    const response = await app.api('GET', '/health', undefined, null);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /payments auth', () => {
  it.each([
    ['no token', null],
    ['the wrong token', 'wrong'],
  ])('refuses %s and moves no money', async (_name, token) => {
    const mandateId = await app.createMandate();
    const merchant = await app.registerMerchant();

    const response = await app.api('POST', '/payments', proposal(mandateId, merchant), token);

    expect(response.status).toBe(401);
    expect(await spent(mandateId)).toBe(0);
  });

  it('refuses everything when no token is configured', async () => {
    const configured = process.env.API_SERVICE_TOKEN;
    delete process.env.API_SERVICE_TOKEN;
    try {
      const response = await app.api('POST', '/payments', {}, 'anything');
      expect(response.status).toBe(401);
    } finally {
      process.env.API_SERVICE_TOKEN = configured;
    }
  });
});

describe('POST /payments', () => {
  it('executes an approved payment', async () => {
    const mandateId = await app.createMandate();
    const merchant = await app.registerMerchant();

    const response = await post(proposal(mandateId, merchant));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: 'executed', replayed: false });
    expect(await spent(mandateId)).toBe(1_000);
  });

  it('replays a retry without paying twice', async () => {
    const mandateId = await app.createMandate();
    const body = proposal(mandateId, await app.registerMerchant());
    const first = await (await post(body)).json();

    const retry = await post(body);

    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ...(first as object), replayed: true });
    expect(await spent(mandateId)).toBe(1_000);
  });

  it('returns 409 when a key is reused for a different request', async () => {
    const mandateId = await app.createMandate();
    const body = proposal(mandateId, await app.registerMerchant());
    await post(body);

    const response = await post({ ...body, amountMinor: 2_000 });

    expect(response.status).toBe(409);
    expect(await spent(mandateId)).toBe(1_000);
  });

  it.each([
    ['a malformed mandate id', { mandateId: 'not-a-uuid' }],
    ['a missing key', { idempotencyKey: undefined }],
  ])('returns 400 for %s', async (_name, change) => {
    const mandateId = await app.createMandate();
    const merchant = await app.registerMerchant();

    const response = await post(proposal(mandateId, merchant, change));

    expect(response.status).toBe(400);
  });

  it('returns 400 for a missing body', async () => {
    expect((await app.api('POST', '/payments')).status).toBe(400);
  });

  it('returns 404 for an unknown mandate', async () => {
    const merchant = await app.registerMerchant();
    const response = await post(proposal(randomUUID(), merchant));
    expect(response.status).toBe(404);
  });
});
