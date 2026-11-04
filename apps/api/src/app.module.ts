import 'reflect-metadata';
import { Controller, Get, Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ApprovalsModule } from './approvals/approvals.module.js';
import { AuditModule } from './audit/audit.module.js';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { DatabaseModule } from './database/database.module.js';
import { MandatesModule } from './mandates/mandates.module.js';
import { MerchantsModule } from './merchants/merchants.module.js';
import { LedgerErrorFilter } from './payments/ledger-error.filter.js';
import { PaymentsModule } from './payments/payments.module.js';
import { RunsModule, type RunsOptions } from './runs/runs.module.js';

@Controller('health')
class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}

@Module({
  imports: [
    ApprovalsModule,
    AuditModule,
    CatalogueModule,
    DatabaseModule,
    MandatesModule,
    MerchantsModule,
    PaymentsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: LedgerErrorFilter }],
})
export class AppModule {
  static register(options?: RunsOptions): DynamicModule {
    return { module: AppModule, imports: [RunsModule.register(options)] };
  }
}
