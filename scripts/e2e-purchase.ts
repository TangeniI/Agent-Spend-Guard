// One real purchase: a live model, the running API and shop, then checks in Postgres.
// Exits non-zero if any check fails. Run it with `pnpm e2e`.
import pg from 'pg';
import { connect, seed } from './seed.ts';

const TASK = 'Buy a phone case under £15.';
const TIMEOUT_MS = 180_000;
const POLL_MS = 1_000;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

const api = connect();
await seed(api);

const mandateResponse = await api.post('/mandates', {
  currency: 'GBP',
  budgetMinor: 5_000,
  perItemLimitMinor: 1_500,
  approvalThresholdMinor: 2_000,
  maxQuantityPerItem: 1,
  allowedMerchantCategories: ['accessories'],
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
});
if (mandateResponse.status !== 201) throw new Error(await mandateResponse.text());
const { id: mandateId } = (await mandateResponse.json()) as { id: string };

const started = await api.post('/runs', { mandateId, task: TASK });
if (started.status === 503) {
  console.error('The API has no LLM. Set GEMINI_API_KEY in .env and restart it.');
  process.exit(2);
}
if (started.status !== 202) throw new Error(await started.text());
const { id: runId } = (await started.json()) as { id: string };

console.log(`Task: ${TASK}\nRun: ${runId}\n`);

interface Step {
  seq: number;
  type: string;
  payload: {
    text?: string;
    name?: string;
    args?: { url?: string };
    output?: { status?: string; reasons?: string[]; error?: string };
  };
}

interface Run {
  status: string;
  result: string | null;
  error: string | null;
  steps: Step[];
}

let run: Run;
let printed = 0;
const deadline = Date.now() + TIMEOUT_MS;
do {
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  run = (await (await api.get(`/runs/${runId}`)).json()) as Run;
  for (const { type, payload } of run.steps.slice(printed)) {
    if (type === 'model' && payload.text) console.log(`model: ${payload.text}`);
    if (type === 'tool') {
      const detail = payload.name === 'read_page' ? payload.args?.url : '';
      console.log(`tool:  ${payload.name} ${detail} ${JSON.stringify(payload.output).slice(0, 120)}`);
    }
  }
  printed = run.steps.length;
} while (run.status === 'running' && Date.now() < deadline);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
const count = async (query: string) => {
  const { rows } = await client.query<{ n: string }>(query, [mandateId]);
  return Number(rows[0]!.n);
};

const executed = await count(
  `SELECT count(*) AS n FROM payments WHERE mandate_id = $1 AND status = 'executed'`,
);
const entriesSum = await count(
  `SELECT coalesce(sum(e.amount_minor), 0) AS n FROM ledger_entries e
   JOIN payments p ON p.id = e.payment_id WHERE p.mandate_id = $1`,
);
const spentMinor = await count(`SELECT spent_minor AS n FROM balances WHERE mandate_id = $1`);
const proposalCount = await count(`SELECT count(*) AS n FROM proposals WHERE mandate_id = $1`);
const decisionEvents = await count(
  `SELECT count(*) AS n FROM audit_events WHERE mandate_id = $1 AND type = 'DECISION_MADE'`,
);
await client.end();

const checks: [string, boolean, string][] = [
  ['The run completed', run.status === 'completed', run.error ?? run.status],
  ['Exactly one payment executed', executed === 1, `${executed} executed`],
  ['It was under £15', spentMinor > 0 && spentMinor <= 1_500, `${spentMinor} spent`],
  ['Ledger entries sum to zero', entriesSum === 0, `sum ${entriesSum}`],
  ['Every proposal has a logged decision', decisionEvents === proposalCount, `${decisionEvents} of ${proposalCount}`],
];

console.log(`\nResult: ${run.result ?? run.error}\n`);
for (const [name, passed, detail] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name} (${detail})`);
}

const failed = checks.filter(([, passed]) => !passed).length;
console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} checks failed.`);
process.exit(failed === 0 ? 0 : 1);
