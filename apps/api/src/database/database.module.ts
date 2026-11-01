import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { createDb, createLedger } from '@asg/ledger';

export const DB = Symbol('DB');
export const LEDGER = Symbol('LEDGER');

export type DbHandle = ReturnType<typeof createDb>;

@Global()
@Module({
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
      useFactory: (handle: DbHandle) => createLedger(handle.db),
    },
  ],
  exports: [DB, LEDGER],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  onModuleDestroy() {
    return this.handle.close();
  }
}
