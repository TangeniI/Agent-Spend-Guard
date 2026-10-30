import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDb, createLedger, migrate, type Ledger } from '@asg/ledger';
import { createTestDatabase, type TestDatabase } from '@asg/ledger/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

let testDb: TestDatabase;
let seed: ReturnType<typeof createDb>;
let ledger: Ledger;
let app: INestApplication;
let baseUrl: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  seed = createDb(testDb.url);
  await migrate(seed.db);
  ledger = createLedger(seed.db);

  process.env.DATABASE_URL = testDb.url;
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  baseUrl = await app.getUrl();
});

afterAll(async () => {
  await app.close();
  await seed.close();
  await testDb.drop();
});

async function openMandate(budgetMinor = 10_000) {
  const mandateId = randomUUID();
  await ledger.openBalance({ mandateId, currency: 'GBP', budgetMinor });
  return mandateId;
}

function post(body: unknown) {
  return fetch(`${baseUrl}/payments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function payment(mandateId: string, overrides: Record<string, unknown> = {}) {
  return {
    mandateId,
    idempotencyKey: randomUUID(),
    merchant: 'shop.example',
    amountMinor: 1_000,
    currency: 'GBP',
    ...overrides,
  };
}

describe('GET /health', () => {
  it('reports ok', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /payments', () => {
  it('executes a payment', async () => {
    const mandateId = await openMandate();
    const response = await post(payment(mandateId));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: 'executed', replayed: false });
    expect((await ledger.getBalance(mandateId)).spentMinor).toBe(1_000);
  });

  it('replays a retry without paying twice', async () => {
    const mandateId = await openMandate();
    const body = payment(mandateId);
    const first = await (await post(body)).json();

    const retry = await post(body);

    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ...first, replayed: true });
    expect((await ledger.getBalance(mandateId)).spentMinor).toBe(1_000);
  });

  it('reports a budget rejection in the body', async () => {
    const mandateId = await openMandate(999);
    const response = await post(payment(mandateId));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      status: 'rejected',
      reasons: ['BUDGET_EXCEEDED'],
    });
  });

  it('returns 409 when a key is reused for a different request', async () => {
    const mandateId = await openMandate();
    const body = payment(mandateId);
    await post(body);

    const response = await post({ ...body, amountMinor: 2_000 });

    expect(response.status).toBe(409);
    expect((await ledger.getBalance(mandateId)).spentMinor).toBe(1_000);
  });

  it.each([
    ['a float amount', { amountMinor: 10.5 }],
    ['a string amount', { amountMinor: '1000' }],
    ['a missing merchant', { merchant: undefined }],
    ['a malformed mandate id', { mandateId: 'not-a-uuid' }],
  ])('returns 400 for %s', async (_name, change) => {
    const mandateId = await openMandate();
    const response = await post(payment(mandateId, change));

    expect(response.status).toBe(400);
    expect((await ledger.getBalance(mandateId)).spentMinor).toBe(0);
  });

  it('returns 400 for a missing body', async () => {
    const response = await fetch(`${baseUrl}/payments`, { method: 'POST' });
    expect(response.status).toBe(400);
  });

  it('returns 404 for an unknown mandate', async () => {
    const response = await post(payment(randomUUID()));
    expect(response.status).toBe(404);
  });
});
