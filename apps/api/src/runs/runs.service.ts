import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  agentRuns,
  agentSteps,
  assertNonEmpty,
  assertUuid,
  auditEvents,
  balances,
  InvalidRequestError,
  mandates,
  UnknownMandateError,
  type LedgerDb,
} from '@asg/ledger';
import {
  buildSystemPrompt,
  createTools,
  runAgent,
  type AgentResult,
  type LlmClient,
  type PageSource,
} from '@asg/agent';
import { asc, desc, eq } from 'drizzle-orm';
import { DB, type DbHandle } from '../database/database.module.js';
import { GuardService } from '../guard/guard.service.js';

export const LLM_CLIENT = Symbol('LLM_CLIENT');
export const PAGE_SOURCE = Symbol('PAGE_SOURCE');
export const SHOP_URL = Symbol('SHOP_URL');

const MAX_TASK_CHARS = 2_000;

@Injectable()
export class RunsService {
  private readonly db: LedgerDb;

  constructor(
    @Inject(DB) handle: DbHandle,
    @Inject(GuardService) private readonly guard: GuardService,
    @Inject(LLM_CLIENT) private readonly llm: LlmClient | null,
    @Inject(PAGE_SOURCE) private readonly pages: PageSource,
    @Inject(SHOP_URL) private readonly shopUrl: string,
  ) {
    this.db = handle.db;
  }

  async start(body: { mandateId?: unknown; task?: unknown } | undefined) {
    assertUuid(body?.mandateId, 'mandateId');
    assertNonEmpty(body?.task, 'task');
    const mandateId = body!.mandateId as string;
    const task = body!.task as string;
    if (task.length > MAX_TASK_CHARS) throw new InvalidRequestError('task is too long');
    if (!this.llm) throw new ServiceUnavailableException('no LLM is configured');

    const [row] = await this.db
      .select({ mandate: mandates, balance: balances })
      .from(mandates)
      .innerJoin(balances, eq(mandates.id, balances.mandateId))
      .where(eq(mandates.id, mandateId));
    if (!row) throw new UnknownMandateError(mandateId);

    const [run] = await this.db.insert(agentRuns).values({ mandateId, task }).returning();
    await this.audit('RUN_STARTED', 'human', mandateId, { runId: run!.id, task });

    const system = buildSystemPrompt({
      shopUrl: this.shopUrl,
      currency: row.balance.currency,
      budgetMinor: row.balance.budgetMinor,
      perItemLimitMinor: row.mandate.perItemLimitMinor,
      maxQuantityPerItem: row.mandate.maxQuantityPerItem,
      allowedMerchantCategories: row.mandate.allowedMerchantCategories,
    });
    void this.execute(this.llm, run!.id, mandateId, task, system);

    return { id: run!.id, status: run!.status };
  }

  list(mandateId: string | undefined) {
    if (mandateId !== undefined) assertUuid(mandateId, 'mandateId');
    return this.db
      .select()
      .from(agentRuns)
      .where(mandateId ? eq(agentRuns.mandateId, mandateId) : undefined)
      .orderBy(desc(agentRuns.createdAt))
      .limit(50);
  }

  async get(id: string) {
    assertUuid(id, 'id');
    const [run] = await this.db.select().from(agentRuns).where(eq(agentRuns.id, id));
    if (!run) throw new NotFoundException(`unknown run ${id}`);
    const steps = await this.db
      .select()
      .from(agentSteps)
      .where(eq(agentSteps.runId, id))
      .orderBy(asc(agentSteps.seq));
    return { ...run, steps };
  }

  private async execute(
    llm: LlmClient,
    runId: string,
    mandateId: string,
    task: string,
    system: string,
  ) {
    let seq = 0;
    let outcome: AgentResult;
    try {
      outcome = await runAgent({
        llm,
        system,
        task,
        tools: createTools({
          runId,
          pages: this.pages,
          // The mandate comes from the run, last, so nothing from the model can replace it.
          propose: (request) => this.guard.propose({ ...request, mandateId }),
        }),
        onStep: async ({ type, ...payload }) => {
          seq += 1;
          await this.db.insert(agentSteps).values({ runId, seq, type, payload });
        },
      });
    } catch (error) {
      outcome = { status: 'failed', error: (error as Error).message };
    }

    await this.db
      .update(agentRuns)
      .set({
        status: outcome.status,
        result: outcome.status === 'completed' ? outcome.result : null,
        error: outcome.status === 'failed' ? outcome.error : null,
        finishedAt: new Date(),
      })
      .where(eq(agentRuns.id, runId));
    await this.audit('RUN_FINISHED', 'system', mandateId, { runId, status: outcome.status });
  }

  private async audit(
    type: string,
    actor: 'human' | 'system',
    mandateId: string,
    payload: object,
  ) {
    await this.db.insert(auditEvents).values({ type, actor, mandateId, payload });
  }
}
