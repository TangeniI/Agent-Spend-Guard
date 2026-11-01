import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDb, migrate } from '@asg/ledger';
import { createTestDatabase } from '@asg/ledger/testing';
import { AppModule } from '../src/app.module.js';

const TOKEN = 'test-service-token';

export interface TestApp {
  db: ReturnType<typeof createDb>['db'];
  baseUrl: string;
  api: (method: string, path: string, body?: unknown, token?: string | null) => Promise<Response>;
  createMandate: (overrides?: Record<string, unknown>) => Promise<string>;
  registerMerchant: (name?: string, category?: string) => Promise<string>;
  stop: () => Promise<void>;
}

export async function startApp(): Promise<TestApp> {
  const testDb = await createTestDatabase();
  const seed = createDb(testDb.url);
  await migrate(seed.db);

  process.env.DATABASE_URL = testDb.url;
  process.env.API_SERVICE_TOKEN = TOKEN;
  const app: INestApplication = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  const baseUrl = await app.getUrl();

  const api: TestApp['api'] = (method, path, body, token = TOKEN) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  return {
    db: seed.db,
    baseUrl,
    api,
    async createMandate(overrides = {}) {
      const response = await api('POST', '/mandates', {
        currency: 'GBP',
        budgetMinor: 100_000,
        perItemLimitMinor: 5_000,
        allowedMerchantCategories: ['accessories'],
        maxQuantityPerItem: 2,
        approvalThresholdMinor: 7_000,
        expiresAt: '2099-01-01T00:00:00Z',
        ...overrides,
      });
      if (response.status !== 201) throw new Error(await response.text());
      return ((await response.json()) as { id: string }).id;
    },
    async registerMerchant(name = `${randomUUID()}.example`, category = 'accessories') {
      const response = await api('POST', '/merchants', { name, category });
      if (response.status !== 201) throw new Error(await response.text());
      return name;
    },
    async stop() {
      await app.close();
      await seed.close();
      await testDb.drop();
    },
  };
}

export function proposal(mandateId: string, merchant: string, overrides: object = {}) {
  return {
    mandateId,
    idempotencyKey: randomUUID(),
    merchant,
    amountMinor: 1_000,
    currency: 'GBP',
    items: [{ name: 'Phone case', quantity: 1, unitPriceMinor: 1_000 }],
    reason: 'The user asked for a phone case.',
    ...overrides,
  };
}
