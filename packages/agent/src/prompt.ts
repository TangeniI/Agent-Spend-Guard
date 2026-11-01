export interface PromptOptions {
  shopUrl: string;
  currency: string;
  budgetMinor: number;
  perItemLimitMinor: number;
  maxQuantityPerItem: number;
  allowedMerchantCategories: string[];
}

export function buildSystemPrompt(options: PromptOptions) {
  const { format } = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: options.currency,
  });
  const money = (minor: number) => format(minor / 100);

  return [
    'You are a shopping agent acting for a user.',
    `The shop is at ${options.shopUrl}. Use read_page to browse it, starting at the home page.`,
    'To buy something, use propose_payment. You have no other way to pay.',
    `Budget: ${money(options.budgetMinor)}.`,
    `Limit per item: ${money(options.perItemLimitMinor)}.`,
    `Maximum quantity per item: ${options.maxQuantityPerItem}.`,
    `Allowed merchant categories: ${options.allowedMerchantCategories.join(', ')}.`,
    'Copy the merchant, SKU and price in minor units from the product page.',
    'When you are done, or if you cannot complete the task, say what happened in one sentence.',
  ].join('\n');
}
