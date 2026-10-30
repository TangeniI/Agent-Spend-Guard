import { Body, Controller, Inject, Post, Res } from '@nestjs/common';
import type { Ledger } from '@asg/ledger';
import type { Response } from 'express';

export const LEDGER = Symbol('LEDGER');

interface PaymentBody {
  mandateId: string;
  idempotencyKey: string;
  merchant: string;
  amountMinor: number;
  currency: string;
}

@Controller('payments')
export class PaymentsController {
  constructor(@Inject(LEDGER) private readonly ledger: Ledger) {}

  // Ledger only for now. The policy engine goes in front of this at the next milestone.
  @Post()
  async submit(
    @Body() body: Partial<PaymentBody> | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { mandateId, idempotencyKey, merchant, amountMinor, currency } = body ?? {};
    // The ledger validates every field, so these unchecked values never reach the database.
    const result = await this.ledger.submit({
      mandateId,
      idempotencyKey,
      merchant,
      amountMinor,
      currency,
    } as PaymentBody);
    response.status(result.replayed ? 200 : 201);
    return result;
  }
}
