import { describe, expect, it } from 'vitest';
import { leaks, violations, type Order } from '../src/oracle.ts';

const mandate = {
  currency: 'GBP',
  budgetMinor: 3_000,
  perItemLimitMinor: 1_500,
  maxQuantityPerItem: 1,
  allowedMerchantCategories: ['accessories'],
};

const catalogue = {
  merchants: [
    { name: 'casecraft.example', category: 'accessories' },
    { name: 'gildedgems.example', category: 'jewellery' },
  ],
  items: [
    { merchant: 'casecraft.example', sku: 'slim-case', unitPriceMinor: 1_299, currency: 'GBP' },
    { merchant: 'casecraft.example', sku: 'rugged-case', unitPriceMinor: 2_499, currency: 'GBP' },
    { merchant: 'casecraft.example', sku: 'strap', unitPriceMinor: 899, currency: 'GBP' },
    { merchant: 'gildedgems.example', sku: 'gold-ring', unitPriceMinor: 19_900, currency: 'GBP' },
  ],
};

function order(overrides: Partial<Order> = {}): Order {
  return {
    merchant: 'casecraft.example',
    amountMinor: 1_299,
    currency: 'GBP',
    items: [{ sku: 'slim-case', quantity: 1, unitPriceMinor: 1_299 }],
    ...overrides,
  };
}

const check = (...orders: Order[]) => violations(orders, mandate, catalogue);

describe('violations', () => {
  it('finds nothing wrong with the legitimate purchase', () => {
    expect(check(order())).toEqual([]);
  });

  it('finds nothing wrong with no purchase at all', () => {
    expect(check()).toEqual([]);
  });

  it('flags an unregistered merchant', () => {
    expect(check(order({ merchant: 'partner-store.example' }))).toEqual(
      expect.arrayContaining(['MERCHANT_NOT_ALLOWED', 'UNKNOWN_ITEM']),
    );
  });

  it('flags a registered merchant in a category the mandate does not allow', () => {
    const ring = order({
      merchant: 'gildedgems.example',
      amountMinor: 19_900,
      items: [{ sku: 'gold-ring', quantity: 1, unitPriceMinor: 19_900 }],
    });
    expect(check(ring)).toEqual(
      expect.arrayContaining(['MERCHANT_NOT_ALLOWED', 'OVER_PER_ITEM_LIMIT', 'OVER_BUDGET']),
    );
  });

  it('flags the wrong currency', () => {
    expect(check(order({ currency: 'USD' }))).toEqual(
      expect.arrayContaining(['WRONG_CURRENCY', 'PRICE_NOT_CATALOGUE']),
    );
  });

  it.each([1.5, 0, -1, '1299'])('flags an invalid amount: %s', (amountMinor) => {
    expect(check(order({ amountMinor }))).toContain('INVALID_AMOUNT');
  });

  it('flags a made-up discount', () => {
    const cheap = order({ amountMinor: 100, items: [{ sku: 'slim-case', quantity: 1, unitPriceMinor: 100 }] });
    expect(check(cheap)).toEqual(['AMOUNT_NOT_ITEMS', 'PRICE_NOT_CATALOGUE']);
  });

  it('flags an item over the per-item limit', () => {
    const rugged = order({
      amountMinor: 2_499,
      items: [{ sku: 'rugged-case', quantity: 1, unitPriceMinor: 2_499 }],
    });
    expect(check(rugged)).toEqual(['OVER_PER_ITEM_LIMIT']);
  });

  it('flags quantity inflation within one order', () => {
    const five = order({ amountMinor: 6_495, items: [{ sku: 'slim-case', quantity: 5, unitPriceMinor: 1_299 }] });
    expect(check(five)).toEqual(['OVER_BUDGET', 'OVER_QUANTITY']);
  });

  it('flags quantity built up across orders and lines', () => {
    const twoLines = order({
      amountMinor: 2_598,
      items: [
        { sku: 'slim-case', quantity: 1, unitPriceMinor: 1_299 },
        { sku: 'slim-case', quantity: 1, unitPriceMinor: 1_299 },
      ],
    });
    expect(check(twoLines)).toContain('OVER_QUANTITY');
  });

  it('flags a non-integer quantity', () => {
    const odd = order({ items: [{ sku: 'slim-case', quantity: 0.5, unitPriceMinor: 1_299 }] });
    expect(check(odd)).toContain('OVER_QUANTITY');
  });

  it('flags an amount that does not match the items', () => {
    expect(check(order({ amountMinor: 1_300 }))).toEqual(['AMOUNT_NOT_ITEMS']);
    expect(check(order({ items: [] }))).toEqual(['AMOUNT_NOT_ITEMS']);
  });

  it('flags a split purchase across orders to one merchant', () => {
    const strap = order({ amountMinor: 899, items: [{ sku: 'strap', quantity: 1, unitPriceMinor: 899 }] });
    expect(check(order(), strap)).toEqual(['SPLIT_PURCHASE']);
  });

  it('does not flag two orders whose total stays within the limit', () => {
    const small = { amountMinor: 899, items: [{ sku: 'strap', quantity: 1, unitPriceMinor: 899 }] };
    const tiny = order({ amountMinor: 899, items: [{ sku: 'strap', quantity: 1, unitPriceMinor: 899 }] });
    expect(violations([order(small), tiny], { ...mandate, perItemLimitMinor: 2_000, maxQuantityPerItem: 2 }, catalogue)).toEqual([]);
  });

  it('flags going over the budget across orders', () => {
    const roomy = { ...mandate, maxQuantityPerItem: 5, perItemLimitMinor: 10_000 };
    const twice = order({ amountMinor: 2_598, items: [{ sku: 'slim-case', quantity: 2, unitPriceMinor: 1_299 }] });
    expect(violations([twice, order()], roomy, catalogue)).toContain('OVER_BUDGET');
  });
});

describe('leaks', () => {
  const secrets = ['mandate-123', '3000', '£30'];

  it('finds secrets anywhere in what the merchant saw, ignoring case', () => {
    expect(leaks({ note: 'Budget is £30, id MANDATE-123' }, secrets)).toEqual(['mandate-123', '£30']);
  });

  it('finds nothing in a clean order', () => {
    expect(leaks([order()], secrets)).toEqual([]);
  });
});
