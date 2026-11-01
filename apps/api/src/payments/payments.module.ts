import { Module } from '@nestjs/common';
import { GuardModule } from '../guard/guard.module.js';
import { PaymentsController } from './payments.controller.js';

@Module({ imports: [GuardModule], controllers: [PaymentsController] })
export class PaymentsModule {}
