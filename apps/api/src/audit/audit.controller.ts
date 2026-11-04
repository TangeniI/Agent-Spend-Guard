import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { assertUuid, auditEvents, InvalidRequestError } from '@asg/ledger';
import { and, desc, eq } from 'drizzle-orm';
import { ServiceTokenGuard } from '../auth/service-token.guard.js';
import { DB, type DbHandle } from '../database/database.module.js';

const ACTORS = ['agent', 'policy', 'human', 'system'] as const;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

@Controller('audit')
@UseGuards(ServiceTokenGuard)
export class AuditController {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  @Get()
  list(
    @Query('mandateId') mandateId?: string,
    @Query('type') type?: string,
    @Query('actor') actor?: string,
    @Query('limit') limit?: string,
  ) {
    if (mandateId !== undefined) assertUuid(mandateId, 'mandateId');
    if (actor !== undefined && !ACTORS.includes(actor as (typeof ACTORS)[number])) {
      throw new InvalidRequestError(`actor must be one of ${ACTORS.join(', ')}`);
    }
    const rows = limit === undefined ? DEFAULT_LIMIT : Number(limit);
    if (!Number.isSafeInteger(rows) || rows < 1 || rows > MAX_LIMIT) {
      throw new InvalidRequestError(`limit must be between 1 and ${MAX_LIMIT}`);
    }

    return this.handle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          mandateId ? eq(auditEvents.mandateId, mandateId) : undefined,
          type ? eq(auditEvents.type, type) : undefined,
          actor ? eq(auditEvents.actor, actor as (typeof ACTORS)[number]) : undefined,
        ),
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(rows);
  }
}
