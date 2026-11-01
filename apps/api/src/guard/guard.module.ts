import { Module } from '@nestjs/common';
import { GuardService } from './guard.service.js';

@Module({ providers: [GuardService], exports: [GuardService] })
export class GuardModule {}
