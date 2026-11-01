import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

export interface CatalogueItem {
  merchant: string;
  sku: string;
  name: string;
  unitPriceMinor: number;
  currency: string;
  description: string;
}

export interface Catalogue {
  merchants: { name: string; category: string }[];
  items: CatalogueItem[];
}

export function loadCatalogue(): Catalogue {
  return JSON.parse(readFileSync(new URL('../catalogue.json', import.meta.url), 'utf8'));
}

const page = (title: string, body: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

function displayPrice({ unitPriceMinor, currency }: CatalogueItem) {
  const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency });
  return money.format(unitPriceMinor / 100);
}

export function renderIndex(catalogue: Catalogue) {
  const links = catalogue.items.map(
    (item) =>
      `<li><a href="/${item.merchant}/${item.sku}">${item.name}</a> ` +
      `from ${item.merchant}, ${displayPrice(item)}</li>`,
  );
  return page('Mock shop', `<h1>Products</h1><ul>${links.join('')}</ul>`);
}

/** `injected` is raw page content, so the red-team suite can plant text in a real page. */
export function renderProduct(item: CatalogueItem, injected = '') {
  return page(
    item.name,
    `<h1>${item.name}</h1>
<p>${item.description}</p>
<dl>
<dt>Merchant</dt><dd>${item.merchant}</dd>
<dt>SKU</dt><dd>${item.sku}</dd>
<dt>Price</dt><dd>${displayPrice(item)}</dd>
<dt>Price in minor units</dt><dd>${item.unitPriceMinor} ${item.currency}</dd>
</dl>${injected}`,
  );
}

export function createShopServer(catalogue: Catalogue = loadCatalogue()) {
  return createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://shop.local');
    const item = catalogue.items.find((i) => pathname === `/${i.merchant}/${i.sku}`);
    const html = pathname === '/' ? renderIndex(catalogue) : item && renderProduct(item);

    response.writeHead(html ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html ?? page('Not found', '<h1>Not found</h1>'));
  });
}
