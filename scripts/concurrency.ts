// Fires concurrent payments at a running API, then checks the outcome directly in Postgres.
// Exits non-zero if any check fails. Run it with `pnpm concurrency`.
import { randomInt, randomUUID } from 'node:crypto';
import pg from 'pg';

const UNIQUE_KEYS = 700;
const RETRIES = 300;
const MERCHANT_COUNT = 50;
const MIN_AMOUNT_MINOR = 100;
const MAX_AMOUNT_MINOR = 500;
const CATEGORY = 'load-test';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const token = process.env.API_SERVICE_TOKEN;
const databaseUrl = process.env.DATABASE_URL;
if (!token) throw new Error('API_SERVICE_TOKEN is not set');
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

interface Proposal {
  mandateId: string;
  idempotencyKey: string;
  merchant: string;
  amountMinor: number;
  currency: string;
  items: { sku: string; quantity: number; unitPriceMinor: number }[];
  reason: string;
}

interface Outcome {
  key: string;
  httpStatus: number;
  paymentId: string | null;
  status: string;
  reasons: string[];
  replayed: boolean;
  ms: number;
}

function post(path: string, body: unknown) {
  return fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function mustPost<T>(path: string, body: unknown): Promise<T> {
  const response = await post(path, body);
  if (response.status !== 201) {
    throw new Error(`POST ${path} returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

function shuffle<T>(values: T[]) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

async function fire(proposal: Proposal): Promise<Outcome> {
  const started = performance.now();
  const response = await post('/payments', proposal);
  const body = (await response.json()) as Omit<Outcome, 'key' | 'httpStatus' | 'ms'>;
  const ms = performance.now() - started;
  return { ...body, key: proposal.idempotencyKey, httpStatus: response.status, ms };
}

function percentile(sorted: number[], p: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

const runId = randomUUID().slice(0, 8);
const merchants = Array.from(
  { length: MERCHANT_COUNT },
  (_, i) => `load-${runId}-${i}.example`,
);
for (const name of merchants) await mustPost('/merchants', { name, category: CATEGORY });

const amounts = Array.from({ length: UNIQUE_KEYS }, () =>
  randomInt(MIN_AMOUNT_MINOR, MAX_AMOUNT_MINOR + 1),
);
const demandMinor = amounts.reduce((sum, amount) => sum + amount, 0);
const budgetMinor = Math.floor(demandMinor / 2);

// Limits sit above total demand, so the only thing that can stop a payment here is the budget.
const { id: mandateId } = await mustPost<{ id: string }>('/mandates', {
  currency: 'GBP',
  budgetMinor,
  perItemLimitMinor: demandMinor,
  approvalThresholdMinor: demandMinor + 1,
  maxQuantityPerItem: 1,
  allowedMerchantCategories: [CATEGORY],
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
});

const unique: Proposal[] = amounts.map((amountMinor, i) => ({
  mandateId,
  idempotencyKey: `${runId}-${i}`,
  merchant: merchants[i % MERCHANT_COUNT]!,
  amountMinor,
  currency: 'GBP',
  items: [{ sku: `sku-${i}`, quantity: 1, unitPriceMinor: amountMinor }],
  reason: 'Concurrency test.',
}));
await mustPost('/catalogue', {
  items: unique.map(({ merchant, items, amountMinor, currency }) => ({
    merchant,
    sku: items[0]!.sku,
    name: 'Load test item',
    unitPriceMinor: amountMinor,
    currency,
  })),
});

const retries = shuffle(unique).slice(0, RETRIES);
const requests = shuffle([...unique, ...retries]);

console.log(`Firing ${requests.length} requests at ${apiUrl}`);
console.log(`Budget ${budgetMinor} against demand ${demandMinor} (minor units, GBP)`);

const started = performance.now();
const outcomes = await Promise.all(requests.map(fire));
const elapsedMs = performance.now() - started;

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
const count = async (query: string) => {
  const { rows } = await client.query<{ n: string }>(query, [mandateId]);
  return Number(rows[0]!.n);
};

const executed = await count(
  `SELECT count(*) AS n FROM payments WHERE mandate_id = $1 AND status = 'executed'`,
);
const rejected = await count(
  `SELECT count(*) AS n FROM payments WHERE mandate_id = $1 AND status = 'rejected'`,
);
const held = await count(
  `SELECT count(*) AS n FROM payments WHERE mandate_id = $1 AND status = 'held'`,
);
const budgetRejections = await count(
  `SELECT count(*) AS n FROM payments
   WHERE mandate_id = $1 AND status = 'rejected' AND reasons = ARRAY['BUDGET_EXCEEDED']`,
);
const duplicateKeys = await count(
  `SELECT count(*) AS n FROM (
     SELECT idempotency_key FROM payments WHERE mandate_id = $1
     GROUP BY idempotency_key HAVING count(*) > 1
   ) d`,
);
const executedAmount = await count(
  `SELECT coalesce(sum(amount_minor), 0) AS n FROM payments
   WHERE mandate_id = $1 AND status = 'executed'`,
);
const entriesSum = await count(
  `SELECT coalesce(sum(e.amount_minor), 0) AS n FROM ledger_entries e
   JOIN payments p ON p.id = e.payment_id WHERE p.mandate_id = $1`,
);
const entryCount = await count(
  `SELECT count(*) AS n FROM ledger_entries e
   JOIN payments p ON p.id = e.payment_id WHERE p.mandate_id = $1`,
);
const proposalCount = await count(`SELECT count(*) AS n FROM proposals WHERE mandate_id = $1`);
const spentMinor = await count(`SELECT spent_minor AS n FROM balances WHERE mandate_id = $1`);
const heldMinor = await count(`SELECT held_minor AS n FROM balances WHERE mandate_id = $1`);
await client.end();

const byKey = new Map<string, Outcome[]>();
for (const outcome of outcomes) {
  byKey.set(outcome.key, [...(byKey.get(outcome.key) ?? []), outcome]);
}
const inconsistentRetries = [...byKey.values()].filter(
  (group) => new Set(group.map((o) => `${o.paymentId}/${o.status}`)).size > 1,
).length;
const acceptedKeys = [...byKey.values()].filter((group) => group[0]!.status === 'executed').length;
const httpFailures = outcomes.filter((o) => o.httpStatus !== 200 && o.httpStatus !== 201).length;
const replayed = outcomes.filter((o) => o.replayed).length;
const remainingMinor = budgetMinor - spentMinor;

const checks: [string, boolean, string][] = [
  ['Every request got a 200 or 201', httpFailures === 0, `${httpFailures} failed`],
  ['Each retry was replayed', replayed === RETRIES, `${replayed} of ${RETRIES}`],
  ['Retries returned the original result', inconsistentRetries === 0, `${inconsistentRetries} differ`],
  ['Executed payments equal accepted keys', executed === acceptedKeys, `${executed} and ${acceptedKeys}`],
  ['No key has more than one payment', duplicateKeys === 0, `${duplicateKeys} duplicated`],
  ['Every key was recorded once', executed + rejected + held === UNIQUE_KEYS, `${executed + rejected + held} of ${UNIQUE_KEYS}`],
  ['Every key has one proposal', proposalCount === UNIQUE_KEYS, `${proposalCount} of ${UNIQUE_KEYS}`],
  ['Ledger entries sum to zero', entriesSum === 0, `sum ${entriesSum}`],
  ['Each executed payment has two entries', entryCount === executed * 2, `${entryCount} entries`],
  ['Remaining budget is at least zero', remainingMinor >= 0, `${remainingMinor} remaining`],
  ['Spent equals the accepted payments', spentMinor === executedAmount, `${spentMinor} and ${executedAmount}`],
  ['Overspending was attempted and refused', budgetRejections > 0, `${budgetRejections} refused`],
  ['Only the budget rejected anything', budgetRejections === rejected, `${budgetRejections} of ${rejected}`],
  ['Nothing went to approval', held === 0 && heldMinor === 0, `${held} held`],
];

const latencies = outcomes.map((o) => o.ms).sort((a, b) => a - b);
console.log(`\nExecuted ${executed}, rejected ${rejected}, replayed ${replayed}`);
console.log(`Spent ${spentMinor} of ${budgetMinor}, ${remainingMinor} remaining`);
console.log(
  `${requests.length} requests in ${Math.round(elapsedMs)} ms, ` +
    `p50 ${Math.round(percentile(latencies, 0.5))} ms, ` +
    `p95 ${Math.round(percentile(latencies, 0.95))} ms\n`,
);

for (const [name, passed, detail] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name} (${detail})`);
}

const failed = checks.filter(([, passed]) => !passed).length;
console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} checks failed.`);
process.exit(failed === 0 ? 0 : 1);
