import { Body, Controller, Inject, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ServiceTokenGuard } from '../auth/service-token.guard.js';
import { GuardService } from '../guard/guard.service.js';

@Controller('payments')
@UseGuards(ServiceTokenGuard)
export class PaymentsController {
  constructor(@Inject(GuardService) private readonly guard: GuardService) {}

  @Post()
  async submit(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const result = await this.guard.propose(body);
    response.status(result.replayed ? 200 : 201);
    return result;
  }
}
