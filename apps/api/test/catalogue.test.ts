import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(() => app.stop());

const line = (merchant: string, overrides: object = {}) => ({
  merchant,
  sku: 'widget',
  name: 'Widget',
  unitPriceMinor: 1_500,
  currency: 'GBP',
  ...overrides,
});

const list = async (merchant: string) =>
  (await (await app.api('GET', `/catalogue?merchant=${merchant}`)).json()) as {
    sku: string;
    unitPriceMinor: number;
  }[];

describe('catalogue', () => {
  it('stores items and lists them by merchant', async () => {
    const merchant = await app.registerMerchant();

    const response = await app.api('POST', '/catalogue', { items: [line(merchant)] });

    expect(response.status).toBe(201);
    expect((await list(merchant)).find((i) => i.sku === 'widget')?.unitPriceMinor).toBe(1_500);
  });

  it('updates the price of an existing item', async () => {
    const merchant = await app.registerMerchant();
    await app.api('POST', '/catalogue', { items: [line(merchant)] });

    await app.api('POST', '/catalogue', { items: [line(merchant, { unitPriceMinor: 1_600 })] });

    expect((await list(merchant)).find((i) => i.sku === 'widget')?.unitPriceMinor).toBe(1_600);
  });

  it.each([
    ['an empty list', () => ({ items: [] })],
    ['no list', () => ({})],
    ['a float price', (m: string) => ({ items: [line(m, { unitPriceMinor: 10.5 })] })],
    ['a bad currency', (m: string) => ({ items: [line(m, { currency: 'gbp' })] })],
    ['a missing SKU', (m: string) => ({ items: [line(m, { sku: '' })] })],
    ['a missing name', (m: string) => ({ items: [line(m, { name: '' })] })],
    ['an unknown merchant', () => ({ items: [line('nobody.example')] })],
    ['a repeated SKU', (m: string) => ({ items: [line(m), line(m)] })],
  ])('refuses %s', async (_name, body) => {
    const merchant = await app.registerMerchant();
    expect((await app.api('POST', '/catalogue', body(merchant))).status).toBe(400);
  });

  it('requires the service token', async () => {
    expect((await app.api('GET', '/catalogue', undefined, null)).status).toBe(401);
  });
});
