import { Module, type DynamicModule } from '@nestjs/common';
import { createLlmFromEnv, ShopPageSource, type LlmClient, type PageSource } from '@asg/agent';
import { GuardModule } from '../guard/guard.module.js';
import { RunsController } from './runs.controller.js';
import { LLM_CLIENT, PAGE_SOURCE, RunsService, SHOP_URL } from './runs.service.js';

export interface RunsOptions {
  llm?: LlmClient;
  pages?: PageSource;
}

const shopUrl = () => process.env.SHOP_URL ?? 'http://localhost:3002';

@Module({})
export class RunsModule {
  static register(options: RunsOptions = {}): DynamicModule {
    return {
      module: RunsModule,
      imports: [GuardModule],
      controllers: [RunsController],
      providers: [
        RunsService,
        { provide: LLM_CLIENT, useFactory: () => options.llm ?? createLlmFromEnv() },
        { provide: SHOP_URL, useFactory: shopUrl },
        {
          provide: PAGE_SOURCE,
          useFactory: () => options.pages ?? new ShopPageSource(shopUrl()),
        },
      ],
    };
  }
}
