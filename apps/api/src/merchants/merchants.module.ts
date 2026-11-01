import { Module } from '@nestjs/common';
import { MerchantsController } from './merchants.controller.js';

@Module({ controllers: [MerchantsController] })
export class MerchantsModule {}
