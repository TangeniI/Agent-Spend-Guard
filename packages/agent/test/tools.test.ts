import { describe, expect, it, vi } from 'vitest';
import {
  createTools,
  deriveIdempotencyKey,
  ShopPageSource,
  type PageSource,
  type ProposalRequest,
} from '../src/index.js';

const pages: PageSource = { read: async (url) => `page at ${url}` };

function tools(propose = vi.fn(async (_: ProposalRequest) => ({
  paymentId: 'p1',
  status: 'executed',
  reasons: [] as string[],
  replayed: false,
}))) {
  const [readPage, proposePayment] = createTools({ runId: 'run-1', pages, propose });
  return { readPage: readPage!, proposePayment: proposePayment!, propose };
}

const args = {
  merchant: 'casecraft.example',
  amount_minor: 1299,
  currency: 'GBP',
  items: [{ sku: 'slim-case', quantity: 1, unit_price_minor: 1299 }],
  reason: 'The user asked for a case.',
};

describe('tools', () => {
  it('gives the model exactly one way to spend', () => {
    const names = createTools({ runId: 'r', pages, propose: vi.fn() }).map((t) => t.definition.name);
    expect(names).toEqual(['read_page', 'propose_payment']);
  });

  it('does not offer the model a key or a mandate parameter', () => {
    const { proposePayment } = tools();
    const schema = proposePayment.definition.parameters as { properties: object };
    expect(Object.keys(schema.properties).sort()).toEqual([
      'amount_minor',
      'currency',
      'items',
      'merchant',
      'reason',
    ]);
  });

  it('maps the model arguments and keeps the raw call', async () => {
    const { proposePayment, propose } = tools();

    await proposePayment.execute(args);

    expect(propose).toHaveBeenCalledWith({
      merchant: 'casecraft.example',
      amountMinor: 1299,
      currency: 'GBP',
      items: [{ sku: 'slim-case', quantity: 1, unitPriceMinor: 1299 }],
      reason: 'The user asked for a case.',
      idempotencyKey: deriveIdempotencyKey('run-1', args),
      rawToolCall: args,
    });
  });

  it('ignores a key or mandate the model tries to supply', async () => {
    const { proposePayment, propose } = tools();

    await proposePayment.execute({
      ...args,
      idempotency_key: 'fresh-key',
      idempotencyKey: 'fresh-key',
      mandateId: 'someone-elses',
    });

    const request = propose.mock.calls[0]![0];
    expect(request.idempotencyKey).toBe(deriveIdempotencyKey('run-1', args));
    expect(request).not.toHaveProperty('mandateId');
  });

  it('passes malformed items on for the guard to reject', async () => {
    const { proposePayment, propose } = tools();
    await proposePayment.execute({ ...args, items: 'three cases' });
    expect(propose.mock.calls[0]![0].items).toEqual([]);
  });

  it('handles non-object items without crashing', async () => {
    const { proposePayment, propose } = tools();
    await proposePayment.execute({ ...args, items: [null, 'x'] });
    expect(propose.mock.calls[0]![0].items).toEqual([
      { sku: undefined, quantity: undefined, unitPriceMinor: undefined },
      { sku: undefined, quantity: undefined, unitPriceMinor: undefined },
    ]);
  });

  it('tells the model only the outcome', async () => {
    const { proposePayment } = tools();
    expect(await proposePayment.execute(args)).toEqual({ status: 'executed', reasons: [] });
  });

  it('reads a page through the page source', async () => {
    const { readPage } = tools();
    expect(await readPage.execute({ url: 'http://shop/a' })).toEqual({
      content: 'page at http://shop/a',
    });
  });
});

describe('deriveIdempotencyKey', () => {
  it('is stable for the same proposal in a run', () => {
    expect(deriveIdempotencyKey('r', args)).toBe(deriveIdempotencyKey('r', { ...args }));
  });

  it('ignores free text, so rewording a retry cannot make it a new payment', () => {
    expect(deriveIdempotencyKey('r', { ...args, reason: 'Trying again, please.' })).toBe(
      deriveIdempotencyKey('r', args),
    );
  });

  it('ignores the order of the items', () => {
    const a = { sku: 'a', quantity: 1, unit_price_minor: 1 };
    const b = { sku: 'b', quantity: 1, unit_price_minor: 1 };
    expect(deriveIdempotencyKey('r', { ...args, items: [a, b] })).toBe(
      deriveIdempotencyKey('r', { ...args, items: [b, a] }),
    );
  });

  it.each([
    ['amount', { amount_minor: 1300 }],
    ['merchant', { merchant: 'other.example' }],
    ['currency', { currency: 'USD' }],
    ['items', { items: [{ sku: 'x', quantity: 2, unit_price_minor: 1299 }] }],
  ])('changes with the %s', (_name, change) => {
    expect(deriveIdempotencyKey('r', { ...args, ...change })).not.toBe(
      deriveIdempotencyKey('r', args),
    );
  });

  it('changes with the run', () => {
    expect(deriveIdempotencyKey('r1', args)).not.toBe(deriveIdempotencyKey('r2', args));
  });

  it('copes with missing fields', () => {
    expect(deriveIdempotencyKey('r', {})).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('ShopPageSource', () => {
  const ok = () =>
    vi.fn(async () => new Response('<h1>Case</h1>', { status: 200 })) as unknown as typeof fetch;

  it('fetches a page on the shop and refuses redirects', async () => {
    const fetcher = ok();
    const source = new ShopPageSource('http://shop.test:3002', fetcher);

    expect(await source.read('http://shop.test:3002/a/b')).toBe('<h1>Case</h1>');
    expect(fetcher).toHaveBeenCalledWith(
      'http://shop.test:3002/a/b',
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('resolves a relative link against the shop', async () => {
    const fetcher = ok();
    await new ShopPageSource('http://shop.test:3002', fetcher).read('/a/b');
    expect(fetcher).toHaveBeenCalledWith('http://shop.test:3002/a/b', expect.anything());
  });

  it.each([
    ['another host', 'http://attacker.example/?budget=500'],
    ['another port', 'http://shop.test:9999/a'],
    ['another scheme', 'https://shop.test:3002/a'],
    ['a lookalike host', 'http://shop.test:3002@attacker.example/a'],
    ['a file URL', 'file:///etc/passwd'],
  ])('refuses %s without making a request', async (_name, url) => {
    const fetcher = ok();
    const source = new ShopPageSource('http://shop.test:3002', fetcher);

    await expect(source.read(url)).rejects.toThrow('outside the shop');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses a value that is not a URL', async () => {
    const source = new ShopPageSource('http://shop.test', ok());
    await expect(source.read(42 as unknown as string)).rejects.toThrow('must be a string');
  });

  it('reports a page that does not load', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    const source = new ShopPageSource('http://shop.test', fetcher);
    await expect(source.read('/missing')).rejects.toThrow('returned 404');
  });

  it('truncates very large pages', async () => {
    const fetcher = vi.fn(
      async () => new Response('x'.repeat(200_000)),
    ) as unknown as typeof fetch;
    const content = await new ShopPageSource('http://shop.test', fetcher).read('/big');
    expect(content).toHaveLength(100_000);
  });
});
