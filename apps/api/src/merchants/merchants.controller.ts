import { Body, ConflictException, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { assertNonEmpty, auditEvents, merchants } from '@asg/ledger';
import { ServiceTokenGuard } from '../auth/service-token.guard.js';
import { DB, type DbHandle } from '../database/database.module.js';

@Controller('merchants')
@UseGuards(ServiceTokenGuard)
export class MerchantsController {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  @Get()
  list() {
    return this.handle.db.select().from(merchants).orderBy(merchants.name);
  }

  @Post()
  register(@Body() body: { name?: unknown; category?: unknown } | undefined) {
    assertNonEmpty(body?.name, 'name');
    assertNonEmpty(body?.category, 'category');
    const values = { name: body!.name as string, category: body!.category as string };

    return this.handle.db.transaction(async (tx) => {
      const [merchant] = await tx
        .insert(merchants)
        .values(values)
        .onConflictDoNothing()
        .returning();
      if (!merchant) throw new ConflictException(`merchant ${values.name} already exists`);

      await tx
        .insert(auditEvents)
        .values({ type: 'MERCHANT_REGISTERED', actor: 'human', payload: values });
      return merchant;
    });
  }
}
