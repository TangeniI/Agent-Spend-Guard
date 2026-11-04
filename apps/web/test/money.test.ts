import { describe, expect, it } from 'vitest';
import { formatMinor } from '@/lib/money';

describe('formatMinor', () => {
  it.each([
    [1299, 'GBP', '£12.99'],
    [5, 'GBP', '£0.05'],
    [0, 'GBP', '£0.00'],
    [-1050, 'GBP', '-£10.50'],
    [123456789, 'GBP', '£1,234,567.89'],
    [1500, 'JPY', 'JP¥1,500'],
  ])('formats %i %s as %s', (minor, currency, expected) => {
    expect(formatMinor(minor, currency)).toBe(expected);
  });

  it('is exact where float division is not', () => {
    // 2^53 + 1 pence cannot be represented once divided by 100 as a float.
    expect(formatMinor(900719925474099, 'GBP')).toBe('£9,007,199,254,740.99');
  });
});
