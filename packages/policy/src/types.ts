export interface LineItem {
  name: string;
  quantity: number;
  unitPriceMinor: number;
}

/** The structured fields of a proposal. It has no `reason`: free text never reaches policy. */
export interface Proposal {
  merchant: string;
  amountMinor: number;
  currency: string;
  items: LineItem[];
}

export interface Mandate {
  currency: string;
  budgetMinor: number;
  perItemLimitMinor: number;
  allowedMerchantCategories: string[];
  blockedMerchants: string[];
  maxQuantityPerItem: number;
  approvalThresholdMinor: number;
  splitWindowMinutes: number;
  expiresAt: Date;
  status: 'active' | 'paused' | 'revoked';
  killSwitch: boolean;
}

export interface RecentPayment {
  amountMinor: number;
  at: Date;
}

export interface Context {
  now: Date;
  /** From the merchant registry. Null means the merchant is not registered. */
  merchantCategory: string | null;
  spentMinor: number;
  heldMinor: number;
  /** Executed and held payments to this merchant. Rejected ones moved nothing. */
  recentToMerchant: RecentPayment[];
}

export type Outcome = 'APPROVE' | 'REJECT' | 'NEEDS_APPROVAL';

export type ReasonCode =
  | 'MANDATE_NOT_FOUND'
  | 'MANDATE_NOT_ACTIVE'
  | 'MANDATE_EXPIRED'
  | 'KILL_SWITCH_ON'
  | 'CURRENCY_MISMATCH'
  | 'INVALID_AMOUNT'
  | 'INVALID_ITEMS'
  | 'AMOUNT_ITEMS_MISMATCH'
  | 'MERCHANT_UNKNOWN'
  | 'MERCHANT_NOT_ALLOWED'
  | 'OVER_PER_ITEM_LIMIT'
  | 'OVER_QUANTITY_LIMIT'
  | 'BUDGET_EXCEEDED'
  | 'SPLIT_PURCHASE_SUSPECTED'
  | 'OVER_APPROVAL_THRESHOLD';

export interface Decision {
  outcome: Outcome;
  reasons: ReasonCode[];
}
