import { Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  assertUuid,
  auditEvents,
  balances,
  mandates,
  payments,
  proposals,
  type Ledger,
  type LedgerDb,
  type LedgerTx,
} from '@asg/ledger';
import { and, desc, eq } from 'drizzle-orm';
import { ServiceTokenGuard } from '../auth/service-token.guard.js';
import { DB, LEDGER, type DbHandle } from '../database/database.module.js';

/** Re-checked under the lock at approval time, because things may have changed while it waited. */
async function recheck(tx: LedgerTx, mandateId: string) {
  const [mandate] = await tx.select().from(mandates).where(eq(mandates.id, mandateId));
  const reasons: string[] = [];
  if (!mandate) return ['MANDATE_NOT_FOUND'];
  if (mandate.status !== 'active') reasons.push('MANDATE_NOT_ACTIVE');
  if (new Date() >= mandate.expiresAt) reasons.push('MANDATE_EXPIRED');
  if (mandate.killSwitch) reasons.push('KILL_SWITCH_ON');
  return reasons;
}

@Controller('approvals')
@UseGuards(ServiceTokenGuard)
export class ApprovalsController {
  private readonly db: LedgerDb;

  constructor(
    @Inject(DB) handle: DbHandle,
    @Inject(LEDGER) private readonly ledger: Ledger,
  ) {
    this.db = handle.db;
  }

  @Get()
  async pending(@Query('mandateId') mandateId: string | undefined) {
    if (mandateId !== undefined) assertUuid(mandateId, 'mandateId');
    const held = and(
      eq(payments.status, 'held'),
      eq(payments.kind, 'payment'),
      mandateId ? eq(payments.mandateId, mandateId) : undefined,
    );
    const rows = await this.db
      .select({ payment: payments, proposal: proposals, balance: balances })
      .from(payments)
      .innerJoin(balances, eq(balances.mandateId, payments.mandateId))
      .leftJoin(
        proposals,
        and(
          eq(proposals.mandateId, payments.mandateId),
          eq(proposals.idempotencyKey, payments.idempotencyKey),
        ),
      )
      .where(held)
      .orderBy(desc(payments.createdAt));

    return rows.map(({ payment, proposal, balance }) => ({
      paymentId: payment.id,
      mandateId: payment.mandateId,
      merchant: payment.merchant,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      reasons: payment.reasons,
      createdAt: payment.createdAt,
      agentReason: proposal?.reason ?? null,
      items: (proposal?.raw as { items?: unknown } | undefined)?.items ?? [],
      balance: {
        budgetMinor: balance.budgetMinor,
        spentMinor: balance.spentMinor,
        heldMinor: balance.heldMinor,
      },
    }));
  }

  @Post(':paymentId/approve')
  async approve(@Param('paymentId') paymentId: string) {
    const result = await this.ledger.capture(paymentId, ({ tx, balance }) =>
      recheck(tx, balance.mandateId),
    );
    if (!result.replayed) {
      await this.audit(
        result.status === 'executed' ? 'APPROVAL_GRANTED' : 'APPROVAL_BLOCKED',
        paymentId,
        result.reasons,
      );
    }
    return result;
  }

  @Post(':paymentId/reject')
  async reject(@Param('paymentId') paymentId: string) {
    const result = await this.ledger.release(paymentId);
    if (!result.replayed) await this.audit('APPROVAL_REJECTED', paymentId, []);
    return result;
  }

  private async audit(type: string, paymentId: string, reasons: string[]) {
    const [payment] = await this.db.select().from(payments).where(eq(payments.id, paymentId));
    await this.db.insert(auditEvents).values({
      type,
      actor: 'human',
      mandateId: payment!.mandateId,
      payload: { paymentId, reasons },
    });
  }
}
