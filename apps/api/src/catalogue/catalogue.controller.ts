import { Body, Controller, Get, Inject, Post, Query, UseGuards } from '@nestjs/common';
import {
  assertCurrency,
  assertNonEmpty,
  assertPositiveMinor,
  auditEvents,
  catalogueItems,
  InvalidRequestError,
  merchants,
} from '@asg/ledger';
import { eq, inArray, sql } from 'drizzle-orm';
import { ServiceTokenGuard } from '../auth/service-token.guard.js';
import { DB, type DbHandle } from '../database/database.module.js';

interface ItemInput {
  merchant: string;
  sku: string;
  name: string;
  unitPriceMinor: number;
  currency: string;
}

function toItem(value: unknown): ItemInput {
  const item = (value ?? {}) as Partial<ItemInput>;
  assertNonEmpty(item.merchant, 'merchant');
  assertNonEmpty(item.sku, 'sku');
  assertNonEmpty(item.name, 'name');
  assertPositiveMinor(item.unitPriceMinor, 'unitPriceMinor');
  assertCurrency(item.currency);
  const { merchant, sku, name, unitPriceMinor, currency } = item as ItemInput;
  return { merchant, sku, name, unitPriceMinor, currency };
}

@Controller('catalogue')
@UseGuards(ServiceTokenGuard)
export class CatalogueController {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  @Get()
  list(@Query('merchant') merchant: string | undefined) {
    const query = this.handle.db.select().from(catalogueItems);
    return merchant ? query.where(eq(catalogueItems.merchant, merchant)) : query;
  }

  @Post()
  upsert(@Body() body: { items?: unknown } | undefined) {
    if (!Array.isArray(body?.items) || body.items.length === 0) {
      throw new InvalidRequestError('items must be a non-empty array');
    }
    const items = body.items.map(toItem);

    const lines = new Set(items.map((item) => JSON.stringify([item.merchant, item.sku])));
    if (lines.size !== items.length) {
      throw new InvalidRequestError('items must not repeat a merchant and SKU');
    }

    return this.handle.db.transaction(async (tx) => {
      const names = [...new Set(items.map((item) => item.merchant))];
      const known = await tx.select().from(merchants).where(inArray(merchants.name, names));
      if (known.length !== names.length) {
        throw new InvalidRequestError('every item must belong to a registered merchant');
      }

      await tx
        .insert(catalogueItems)
        .values(items)
        .onConflictDoUpdate({
          target: [catalogueItems.merchant, catalogueItems.sku],
          set: {
            name: sql`excluded.name`,
            unitPriceMinor: sql`excluded.unit_price_minor`,
            currency: sql`excluded.currency`,
          },
        });
      await tx.insert(auditEvents).values({
        type: 'CATALOGUE_UPDATED',
        actor: 'human',
        payload: { merchants: names, items: items.length },
      });
      return { items: items.length };
    });
  }
}
