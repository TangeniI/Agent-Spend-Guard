import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import {
  IdempotencyConflictError,
  InvalidRequestError,
  InvalidStateError,
  LedgerError,
  UnknownMandateError,
  UnknownPaymentError,
} from '@asg/ledger';
import type { Response } from 'express';

function statusFor(error: LedgerError) {
  if (error instanceof InvalidRequestError) return 400;
  if (error instanceof UnknownMandateError || error instanceof UnknownPaymentError) return 404;
  if (error instanceof IdempotencyConflictError || error instanceof InvalidStateError) return 409;
  return 500;
}

@Catch(LedgerError)
export class LedgerErrorFilter implements ExceptionFilter {
  catch(error: LedgerError, host: ArgumentsHost) {
    const statusCode = statusFor(error);
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(statusCode)
      .json({ statusCode, error: error.name, message: error.message });
  }
}
