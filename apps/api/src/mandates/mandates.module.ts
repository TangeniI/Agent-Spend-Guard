import { Module } from '@nestjs/common';
import { MandatesController } from './mandates.controller.js';

@Module({ controllers: [MandatesController] })
export class MandatesModule {}
