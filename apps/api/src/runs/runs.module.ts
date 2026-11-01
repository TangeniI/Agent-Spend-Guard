import { Module, type DynamicModule } from '@nestjs/common';
import { GeminiClient, ShopPageSource, type LlmClient, type PageSource } from '@asg/agent';
import { GuardModule } from '../guard/guard.module.js';
import { RunsController } from './runs.controller.js';
import { LLM_CLIENT, PAGE_SOURCE, RunsService, SHOP_URL } from './runs.service.js';

export interface RunsOptions {
  llm?: LlmClient;
  pages?: PageSource;
}

const shopUrl = () => process.env.SHOP_URL ?? 'http://localhost:3002';

function geminiFromEnv() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GeminiClient({ apiKey, model: process.env.GEMINI_MODEL ?? 'gemini-3.8-flash' });
}

@Module({})
export class RunsModule {
  static register(options: RunsOptions = {}): DynamicModule {
    return {
      module: RunsModule,
      imports: [GuardModule],
      controllers: [RunsController],
      providers: [
        RunsService,
        { provide: LLM_CLIENT, useFactory: () => options.llm ?? geminiFromEnv() },
        { provide: SHOP_URL, useFactory: shopUrl },
        {
          provide: PAGE_SOURCE,
          useFactory: () => options.pages ?? new ShopPageSource(shopUrl()),
        },
      ],
    };
  }
}
