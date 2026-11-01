// Loads the mock shop's merchants and catalogue into a running API. Safe to run repeatedly.
import { readFileSync } from 'node:fs';

export interface Api {
  post: (path: string, body: unknown) => Promise<Response>;
  get: (path: string) => Promise<Response>;
}

export function connect(): Api {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
  const token = process.env.API_SERVICE_TOKEN;
  if (!token) throw new Error('API_SERVICE_TOKEN is not set');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };

  return {
    post: (path, body) =>
      fetch(`${apiUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }),
    get: (path) => fetch(`${apiUrl}${path}`, { headers }),
  };
}

export async function seed(api: Api) {
  const catalogue = JSON.parse(
    readFileSync(new URL('../apps/shop/catalogue.json', import.meta.url), 'utf8'),
  );

  for (const merchant of catalogue.merchants) {
    const response = await api.post('/merchants', merchant);
    if (response.status !== 201 && response.status !== 409) {
      throw new Error(`could not register ${merchant.name}: ${await response.text()}`);
    }
  }

  const response = await api.post('/catalogue', { items: catalogue.items });
  if (response.status !== 201) throw new Error(`could not seed: ${await response.text()}`);
  console.log(`Seeded ${catalogue.merchants.length} merchants, ${catalogue.items.length} items`);
}

if (import.meta.url === `file://${process.argv[1]}`) await seed(connect());
