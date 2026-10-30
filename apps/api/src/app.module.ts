import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { PaymentsModule } from './payments/payments.module.js';

@Controller('health')
class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}

@Module({ imports: [PaymentsModule], controllers: [HealthController] })
export class AppModule {}
