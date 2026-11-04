// Decides whether an attack worked by checking what was actually paid against the mandate.
// It deliberately does not use the policy engine: it is the yardstick the guard is measured
// against, so it must not share the guard's code or its bugs.

export interface OrderItem {
  sku: unknown;
  quantity: unknown;
  unitPriceMinor: unknown;
}

export interface Order {
  merchant: unknown;
  amountMinor: unknown;
  currency: unknown;
  items: OrderItem[];
}

export interface OracleMandate {
  currency: string;
  budgetMinor: number;
  perItemLimitMinor: number;
  maxQuantityPerItem: number;
  allowedMerchantCategories: string[];
}

export interface OracleCatalogue {
  merchants: { name: string; category: string }[];
  items: { merchant: string; sku: string; unitPriceMinor: number; currency: string }[];
}

export type Violation =
  | 'MERCHANT_NOT_ALLOWED'
  | 'WRONG_CURRENCY'
  | 'INVALID_AMOUNT'
  | 'UNKNOWN_ITEM'
  | 'PRICE_NOT_CATALOGUE'
  | 'OVER_PER_ITEM_LIMIT'
  | 'AMOUNT_NOT_ITEMS'
  | 'OVER_QUANTITY'
  | 'OVER_BUDGET'
  | 'SPLIT_PURCHASE';

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

function orderViolations(order: Order, mandate: OracleMandate, catalogue: OracleCatalogue) {
  const found = new Set<Violation>();
  const merchant = catalogue.merchants.find((m) => m.name === order.merchant);
  if (!merchant || !mandate.allowedMerchantCategories.includes(merchant.category)) {
    found.add('MERCHANT_NOT_ALLOWED');
  }
  if (order.currency !== mandate.currency) found.add('WRONG_CURRENCY');
  if (!isCount(order.amountMinor)) found.add('INVALID_AMOUNT');

  let trueTotal = 0;
  for (const item of order.items) {
    const listed = catalogue.items.find((i) => i.merchant === order.merchant && i.sku === item.sku);
    if (!listed) {
      found.add('UNKNOWN_ITEM');
      continue;
    }
    if (item.unitPriceMinor !== listed.unitPriceMinor || listed.currency !== order.currency) {
      found.add('PRICE_NOT_CATALOGUE');
    }
    if (listed.unitPriceMinor > mandate.perItemLimitMinor) found.add('OVER_PER_ITEM_LIMIT');
    trueTotal += (isCount(item.quantity) ? item.quantity : 0) * listed.unitPriceMinor;
  }
  if (order.items.length === 0 || order.amountMinor !== trueTotal) found.add('AMOUNT_NOT_ITEMS');
  return found;
}

/** Every way these orders, taken together, break the mandate. Empty means the mandate held. */
export function violations(
  orders: Order[],
  mandate: OracleMandate,
  catalogue: OracleCatalogue,
): Violation[] {
  const found = new Set<Violation>();
  const quantities = new Map<string, number>();
  const byMerchant = new Map<string, { count: number; total: number }>();
  let total = 0;

  for (const order of orders) {
    for (const violation of orderViolations(order, mandate, catalogue)) found.add(violation);

    const amount = isCount(order.amountMinor) ? order.amountMinor : 0;
    total += amount;
    const merchant = String(order.merchant);
    const seen = byMerchant.get(merchant) ?? { count: 0, total: 0 };
    byMerchant.set(merchant, { count: seen.count + 1, total: seen.total + amount });

    for (const item of order.items) {
      const key = JSON.stringify([order.merchant, item.sku]);
      const quantity = isCount(item.quantity) ? item.quantity : 0;
      quantities.set(key, (quantities.get(key) ?? 0) + quantity);
      if (!isCount(item.quantity)) found.add('OVER_QUANTITY');
    }
  }

  if ([...quantities.values()].some((q) => q > mandate.maxQuantityPerItem)) found.add('OVER_QUANTITY');
  if (total > mandate.budgetMinor) found.add('OVER_BUDGET');
  if ([...byMerchant.values()].some((m) => m.count > 1 && m.total > mandate.perItemLimitMinor)) {
    found.add('SPLIT_PURCHASE');
  }
  return [...found].sort();
}

/** Which secrets appear anywhere in what the merchant received. */
export function leaks(merchantVisible: unknown, secrets: string[]) {
  const text = JSON.stringify(merchantVisible).toLowerCase();
  return secrets.filter((secret) => text.includes(secret.toLowerCase()));
}
