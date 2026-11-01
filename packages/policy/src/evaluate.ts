import type { Context, Decision, LineItem, Mandate, Proposal, ReasonCode } from './types.js';

const isPositiveMinor = (value: number) => Number.isSafeInteger(value) && value > 0;

function catalogueReason(item: LineItem, currency: string, context: Context): ReasonCode | null {
  if (!Object.hasOwn(context.catalogue, item.sku)) return 'UNKNOWN_ITEM';
  const listed = context.catalogue[item.sku]!;
  return listed.unitPriceMinor === item.unitPriceMinor && listed.currency === currency
    ? null
    : 'PRICE_MISMATCH';
}

function quantityBySku(items: LineItem[]) {
  const totals = new Map<string, number>();
  for (const item of items) totals.set(item.sku, (totals.get(item.sku) ?? 0) + item.quantity);
  return [...totals.values()];
}

function itemReasons(proposal: Proposal, mandate: Mandate, context: Context): ReasonCode[] {
  const { items, amountMinor } = proposal;
  const valid =
    items.length > 0 &&
    items.every((i) => isPositiveMinor(i.quantity) && isPositiveMinor(i.unitPriceMinor));
  if (!valid) return ['INVALID_ITEMS'];

  const reasons = new Set<ReasonCode>();
  for (const item of items) {
    const reason = catalogueReason(item, proposal.currency, context);
    if (reason) reasons.add(reason);
  }

  const total = items.reduce((sum, i) => sum + i.quantity * i.unitPriceMinor, 0);
  if (isPositiveMinor(amountMinor) && total !== amountMinor) reasons.add('AMOUNT_ITEMS_MISMATCH');
  if (items.some((i) => i.unitPriceMinor > mandate.perItemLimitMinor)) {
    reasons.add('OVER_PER_ITEM_LIMIT');
  }
  if (quantityBySku(items).some((quantity) => quantity > mandate.maxQuantityPerItem)) {
    reasons.add('OVER_QUANTITY_LIMIT');
  }
  return [...reasons];
}

function isSplitPurchase(proposal: Proposal, mandate: Mandate, context: Context) {
  const windowStart = context.now.getTime() - mandate.splitWindowMinutes * 60_000;
  const recent = context.recentToMerchant.filter((p) => p.at.getTime() > windowStart);
  if (recent.length === 0) return false;
  const sum = recent.reduce((total, p) => total + p.amountMinor, proposal.amountMinor);
  return sum > mandate.perItemLimitMinor;
}

/** Pure and deterministic. Reads only structured fields, so agent free text cannot affect it. */
export function evaluate(
  proposal: Proposal,
  mandate: Mandate | null,
  context: Context,
): Decision {
  if (!mandate) return { outcome: 'REJECT', reasons: ['MANDATE_NOT_FOUND'] };

  const rejections: ReasonCode[] = [];
  if (mandate.status !== 'active') rejections.push('MANDATE_NOT_ACTIVE');
  if (context.now >= mandate.expiresAt) rejections.push('MANDATE_EXPIRED');
  if (mandate.killSwitch) rejections.push('KILL_SWITCH_ON');
  if (proposal.currency !== mandate.currency) rejections.push('CURRENCY_MISMATCH');

  const validAmount = isPositiveMinor(proposal.amountMinor);
  if (!validAmount) rejections.push('INVALID_AMOUNT');

  if (context.merchantCategory === null) {
    rejections.push('MERCHANT_UNKNOWN');
  } else if (
    !mandate.allowedMerchantCategories.includes(context.merchantCategory) ||
    mandate.blockedMerchants.includes(proposal.merchant)
  ) {
    rejections.push('MERCHANT_NOT_ALLOWED');
  }

  rejections.push(...itemReasons(proposal, mandate, context));

  const committed = context.spentMinor + context.heldMinor;
  if (validAmount && committed + proposal.amountMinor > mandate.budgetMinor) {
    rejections.push('BUDGET_EXCEEDED');
  }

  if (rejections.length > 0) return { outcome: 'REJECT', reasons: rejections };

  const approvals: ReasonCode[] = [];
  if (isSplitPurchase(proposal, mandate, context)) approvals.push('SPLIT_PURCHASE_SUSPECTED');
  if (proposal.amountMinor >= mandate.approvalThresholdMinor) {
    approvals.push('OVER_APPROVAL_THRESHOLD');
  }

  return approvals.length > 0
    ? { outcome: 'NEEDS_APPROVAL', reasons: approvals }
    : { outcome: 'APPROVE', reasons: [] };
}
