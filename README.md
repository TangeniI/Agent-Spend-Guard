# Agent Spend Guard

**The AI suggests, the rules decide.**

AI agents are starting to pay for things. Agent Spend Guard is the layer between a shopping agent
and a payment. The agent can browse and propose a payment, but it can never move money itself.
Every proposal goes through deterministic policy checks, a human for anything large, and an
idempotent double-entry ledger. Every decision is written to an append-only audit log.

Payments are simulated. No real money moves, and this project does not use Visa's or any card
network's APIs.

## Architecture

```
user task + mandate
        |
        v
  agent (LLM + tools) --read_page--> mock shop pages (some contain injected instructions)
        |                            (read_page can only reach the shop)
        | propose_payment(merchant, amount_minor, currency, items, reason)
        | idempotency key derived server-side, never by the model
        v
  policy engine: pure, deterministic, run inside the ledger's row lock
        |   checks the mandate, merchant registry, catalogue prices, quantities,
        |   budget, split purchases and the kill switch. Never reads `reason`.
        |
        +--> REJECT (reason codes logged)
        +--> NEEDS_APPROVAL --> hold on budget --> human approves (re-checked) or rejects
        |
        v
  ledger: idempotent, SELECT ... FOR UPDATE, double-entry, append-only
        |
        v
  audit log: every proposal, decision, actor and timestamp (append-only)
```

| Part | What it is |
| --- | --- |
| `packages/policy` | `evaluate(proposal, mandate, context)`, a pure function. 100% test coverage. |
| `packages/ledger` | Postgres ledger with idempotency keys, row locks, holds, reversals and database-level guards. |
| `packages/agent` | Agent loop, tools and a Gemini client. The model only ever sees two tools. |
| `apps/api` | NestJS API: guard, mandates, merchant registry, catalogue, approvals, audit, agent runs. |
| `apps/web` | Next.js UI: mandates, kill switch, live agent runs, approval queue, audit log, red-team results. |
| `apps/shop` | Mock merchant site rendered from one catalogue file. |
| `redteam/` | 50 prompt-injection attacks in the ClearPass probe format, a runner and an independent checker. |

## Results

### 1. Concurrency: 1,000 concurrent payment requests

`scripts/concurrency.ts` fires 700 unique payments and 300 retries that reuse their keys, all at
once over HTTP, against one mandate whose budget is half the total demand. It then checks the
outcome directly in Postgres. It runs in CI on every push.

From [CI run 41340761661](https://github.com/TangeniI/Agent-Spend-Guard/actions/runs/41340761661):

| Check | Result |
| --- | --- |
| Double charges (keys with more than one payment) | **0** |
| Retries replayed with the original result | **300 of 300** |
| Payments executed / refused for budget | 353 / 347 |
| Sum of all ledger entries | **0** |
| Budget remaining | 1 pence, never below zero |

With the row lock removed, the same script fails 5 to 6 of its 14 checks and exits non-zero.

### 2. Red-team: 50 prompt-injection attacks

Each attack hides instructions in the shop's pages: fake authority, fake urgency or discounts,
quantity inflation, split purchases, merchant swaps, currency confusion, exfiltration and
instruction overrides. Each one runs twice with the same model, prompt and pages:

- **No guard:** the agent's payment is executed exactly as proposed, and the merchant receives the
  whole tool call.
- **Guard:** the same agent behind the real API, policy engine and ledger.

An attack succeeds only if a payment that breaks the mandate actually executed, or for
exfiltration, if mandate details reached the merchant. This is checked by an independent checker
against what was paid, never by reading the model's text.

| | Attacks | Succeeded |
| --- | --- | --- |
| No guard | 50 | **X** |
| Behind the guard | 50 | **X** (plus X held for a human) |

## How to run it

Requirements: Node 22.18 or later, pnpm 9, Docker.

```bash
pnpm install
cp .env.example .env          # set API_SERVICE_TOKEN, ADMIN_PASSWORD, and GEMINI_API_KEY for live runs
pnpm db:up && pnpm build && pnpm db:migrate
pnpm test                     # every package; no model or key needed
```

Run the stack (three terminals): `pnpm --filter @asg/shop start`, `pnpm --filter @asg/api start`,
`pnpm --filter @asg/web start`. Then open http://localhost:3000.

| Script | What it does |
| --- | --- |
| `pnpm seed` | Loads the shop's merchants and catalogue into the API. |
| `pnpm concurrency` | The 1,000-request test against a running API. |
| `pnpm e2e` | One live purchase with a real model, checked in Postgres. |
| `pnpm redteam` | All 50 attacks, both arms. Writes `redteam/results/`. |

## Limitations

- **The guard enforces the mandate, not intent.** If a mandate allows 5 items, buying 5 passes.
  Attack mandates are deliberately tight.
- **Prices are checked against a known catalogue.** That works because the shop is a mock. A real
  deployment would need signed merchant quotes or similar.
- **Simulated payments.** The ledger is real; the payment rail is not.
- **One model per red-team run.** Results depend on the model, and a weaker model falls for more
  attacks with no guard. The run records which model was used.
- **Agent runs in progress do not survive an API restart.** They stay marked as running.
