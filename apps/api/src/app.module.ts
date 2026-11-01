import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { DatabaseModule } from './database/database.module.js';
import { MandatesModule } from './mandates/mandates.module.js';
import { MerchantsModule } from './merchants/merchants.module.js';
import { LedgerErrorFilter } from './payments/ledger-error.filter.js';
import { PaymentsModule } from './payments/payments.module.js';

@Controller('health')
class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}

@Module({
  imports: [CatalogueModule, DatabaseModule, MandatesModule, MerchantsModule, PaymentsModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: LedgerErrorFilter }],
})
export class AppModule {}
