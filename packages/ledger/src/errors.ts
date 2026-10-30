export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidRequestError extends LedgerError {}

export class UnknownMandateError extends LedgerError {
  constructor(mandateId: string) {
    super(`unknown mandate ${mandateId}`);
  }
}

export class UnknownPaymentError extends LedgerError {
  constructor(paymentId: string) {
    super(`unknown payment ${paymentId}`);
  }
}

/** The key was already used for a different request. */
export class IdempotencyConflictError extends LedgerError {
  constructor(idempotencyKey: string) {
    super(`idempotency key ${idempotencyKey} was used with a different request`);
  }
}

export class InvalidStateError extends LedgerError {}
