import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { createDb, createLedger } from '@asg/ledger';
import { LedgerErrorFilter } from './ledger-error.filter.js';
import { LEDGER, PaymentsController } from './payments.controller.js';

const DB = Symbol('DB');

@Module({
  controllers: [PaymentsController],
  providers: [
    {
      provide: DB,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error('DATABASE_URL is not set');
        return createDb(url);
      },
    },
    {
      provide: LEDGER,
      inject: [DB],
      useFactory: (handle: ReturnType<typeof createDb>) => createLedger(handle.db),
    },
    { provide: APP_FILTER, useClass: LedgerErrorFilter },
  ],
})
export class PaymentsModule implements OnModuleDestroy {
  constructor(@Inject(DB) private readonly handle: ReturnType<typeof createDb>) {}

  onModuleDestroy() {
    return this.handle.close();
  }
}
