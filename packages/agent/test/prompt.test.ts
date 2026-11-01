import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/index.js';

const prompt = buildSystemPrompt({
  shopUrl: 'http://shop.test',
  currency: 'GBP',
  budgetMinor: 5_000,
  perItemLimitMinor: 2_000,
  maxQuantityPerItem: 1,
  allowedMerchantCategories: ['accessories'],
});

describe('buildSystemPrompt', () => {
  it('tells the agent where to shop', () => {
    expect(prompt).toContain('http://shop.test');
  });

  it('formats limits from integer minor units', () => {
    expect(prompt).toContain('£50.00');
    expect(prompt).toContain('£20.00');
  });

  it('names the only way to pay', () => {
    expect(prompt).toContain('propose_payment');
  });
});
