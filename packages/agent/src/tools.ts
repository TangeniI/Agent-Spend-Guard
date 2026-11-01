import { createHash } from 'node:crypto';
import type { PageSource } from './pages.js';
import type { Tool } from './types.js';

export interface ProposalRequest {
  merchant: unknown;
  amountMinor: unknown;
  currency: unknown;
  items: unknown[];
  reason: unknown;
  idempotencyKey: string;
  rawToolCall: Record<string, unknown>;
}

export interface ProposalOutcome {
  status: string;
  reasons: string[];
}

export interface ToolOptions {
  runId: string;
  pages: PageSource;
  propose: (request: ProposalRequest) => Promise<ProposalOutcome>;
}

const itemsOf = (args: Record<string, unknown>) =>
  (Array.isArray(args.items) ? args.items : []) as (Record<string, unknown> | null)[];

/**
 * Derived here so the model never touches it. The same proposal in a run replays rather than
 * paying again, and `reason` is left out so rewording a retry cannot make it a new payment.
 */
export function deriveIdempotencyKey(runId: string, args: Record<string, unknown>) {
  const items = itemsOf(args)
    .map((item) => JSON.stringify([item?.sku, item?.quantity, item?.unit_price_minor]))
    .sort();
  const fingerprint = [runId, args.merchant, args.amount_minor, args.currency, items];
  return createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
}

export function createTools({ runId, pages, propose }: ToolOptions): Tool[] {
  return [
    {
      definition: {
        name: 'read_page',
        description: 'Read a page of the shop. Returns its HTML.',
        parameters: {
          type: 'object',
          properties: { url: { type: 'string', description: 'The page URL or path.' } },
          required: ['url'],
        },
      },
      execute: async (args) => ({ content: await pages.read(args.url as string) }),
    },
    {
      definition: {
        name: 'propose_payment',
        description:
          'Propose a payment. This is the only way to buy anything. Rules outside your ' +
          'control decide whether it goes ahead, and the result says what happened.',
        parameters: {
          type: 'object',
          properties: {
            merchant: { type: 'string', description: 'The merchant name from the product page.' },
            amount_minor: {
              type: 'integer',
              description: 'The total in minor units, for example 1299 for £12.99.',
            },
            currency: { type: 'string', description: 'A three-letter code such as GBP.' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sku: { type: 'string' },
                  quantity: { type: 'integer' },
                  unit_price_minor: { type: 'integer' },
                },
                required: ['sku', 'quantity', 'unit_price_minor'],
              },
            },
            reason: { type: 'string', description: 'Why you are buying this.' },
          },
          required: ['merchant', 'amount_minor', 'currency', 'items', 'reason'],
        },
      },
      execute: async (args) => {
        const { status, reasons } = await propose({
          merchant: args.merchant,
          amountMinor: args.amount_minor,
          currency: args.currency,
          items: itemsOf(args).map((item) => ({
            sku: item?.sku,
            quantity: item?.quantity,
            unitPriceMinor: item?.unit_price_minor,
          })),
          reason: args.reason,
          idempotencyKey: deriveIdempotencyKey(runId, args),
          rawToolCall: args,
        });
        return { status, reasons };
      },
    },
  ];
}
