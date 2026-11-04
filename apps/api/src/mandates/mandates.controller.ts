import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  assertPositiveMinor,
  assertUuid,
  auditEvents,
  balances,
  InvalidRequestError,
  lockBalance,
  mandates,
  UnknownMandateError,
  type Ledger,
} from '@asg/ledger';
import { desc, eq } from 'drizzle-orm';
import { ServiceTokenGuard } from '../auth/service-token.guard.js';
import { DB, LEDGER, type DbHandle } from '../database/database.module.js';

type MandateBody = Record<string, unknown> | undefined;

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new InvalidRequestError(`${field} must be an array of strings`);
  }
  return value;
}

function toDate(value: unknown) {
  const date = new Date(typeof value === 'string' ? value : Number.NaN);
  if (Number.isNaN(date.getTime())) throw new InvalidRequestError('expiresAt must be a date');
  return date;
}

const MAX_INT = 2_147_483_647;

function windowMinutes(value: unknown) {
  if (value === undefined) return 10;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_INT) {
    throw new InvalidRequestError('splitWindowMinutes must be a non-negative integer');
  }
  return value;
}

function maxQuantity(value: unknown) {
  assertPositiveMinor(value, 'maxQuantityPerItem');
  if ((value as number) > MAX_INT) throw new InvalidRequestError('maxQuantityPerItem is too large');
  return value as number;
}

@Controller('mandates')
@UseGuards(ServiceTokenGuard)
export class MandatesController {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(LEDGER) private readonly ledger: Ledger,
  ) {}

  @Post()
  create(@Body() body: MandateBody) {
    const input = body ?? {};
    assertPositiveMinor(input.perItemLimitMinor, 'perItemLimitMinor');
    assertPositiveMinor(input.approvalThresholdMinor, 'approvalThresholdMinor');

    const id = randomUUID();
    const values = {
      id,
      perItemLimitMinor: input.perItemLimitMinor as number,
      approvalThresholdMinor: input.approvalThresholdMinor as number,
      maxQuantityPerItem: maxQuantity(input.maxQuantityPerItem),
      allowedMerchantCategories: stringArray(
        input.allowedMerchantCategories,
        'allowedMerchantCategories',
      ),
      blockedMerchants: stringArray(input.blockedMerchants ?? [], 'blockedMerchants'),
      splitWindowMinutes: windowMinutes(input.splitWindowMinutes),
      expiresAt: toDate(input.expiresAt),
    };

    return this.handle.db.transaction(async (tx) => {
      await this.ledger.openBalance(
        {
          mandateId: id,
          currency: input.currency as string,
          budgetMinor: input.budgetMinor as number,
        },
        tx,
      );
      const [mandate] = await tx.insert(mandates).values(values).returning();
      await tx
        .insert(auditEvents)
        .values({ type: 'MANDATE_CREATED', actor: 'human', mandateId: id, payload: values });
      return mandate;
    });
  }

  @Get()
  async list() {
    const rows = await this.handle.db
      .select({ mandate: mandates, balance: balances })
      .from(mandates)
      .innerJoin(balances, eq(mandates.id, balances.mandateId))
      .orderBy(desc(mandates.createdAt))
      .limit(100);
    return rows.map((row) => ({ ...row.mandate, balance: row.balance }));
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    assertUuid(id, 'id');
    const [row] = await this.handle.db
      .select({ mandate: mandates, balance: balances })
      .from(mandates)
      .innerJoin(balances, eq(mandates.id, balances.mandateId))
      .where(eq(mandates.id, id));
    if (!row) throw new UnknownMandateError(id);
    return { ...row.mandate, balance: row.balance };
  }

  /**
   * Takes the balance lock, so once this returns no in-flight proposal can still be deciding
   * against the old status or kill switch.
   */
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: MandateBody) {
    assertUuid(id, 'id');
    const { status, killSwitch } = body ?? {};
    if (status !== undefined && status !== 'active' && status !== 'paused' && status !== 'revoked') {
      throw new InvalidRequestError('status must be active, paused or revoked');
    }
    if (killSwitch !== undefined && typeof killSwitch !== 'boolean') {
      throw new InvalidRequestError('killSwitch must be a boolean');
    }
    if (status === undefined && killSwitch === undefined) {
      throw new InvalidRequestError('nothing to update');
    }

    return this.handle.db.transaction(async (tx) => {
      await lockBalance(tx, id);
      const [mandate] = await tx
        .update(mandates)
        .set({ status, killSwitch })
        .where(eq(mandates.id, id))
        .returning();
      if (!mandate) throw new UnknownMandateError(id);
      await tx.insert(auditEvents).values({
        type: 'MANDATE_UPDATED',
        actor: 'human',
        mandateId: id,
        payload: { status, killSwitch },
      });
      return mandate;
    });
  }
}
