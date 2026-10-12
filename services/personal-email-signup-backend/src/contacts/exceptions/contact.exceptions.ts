import { HttpStatus } from '@nestjs/common';

export abstract class DomainException extends Error {
  constructor(message: string, readonly status: HttpStatus, readonly correlationId: string) {
    super(message);
  }
}

export class InvalidPhoneException extends DomainException {
  constructor(readonly phone: string, correlationId: string) {
    super('Invalid phone number provided', HttpStatus.BAD_REQUEST, correlationId);
  }
}

export class DuplicateContactException extends DomainException {
  constructor(readonly phoneHash: string, correlationId: string) {
    super('Duplicate contact upload detected', HttpStatus.UNPROCESSABLE_ENTITY, correlationId);
  }
}

export class RateLimitExceededException extends DomainException {
  constructor(correlationId: string) {
    super('Contact upload rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS, correlationId);
  }
}

export class AnomalousContactUploadException extends DomainException {
  constructor(readonly signals: string[], correlationId: string, readonly retryAfterSeconds?: number) {
    super('Contact upload blocked due to suspicious activity', HttpStatus.TOO_MANY_REQUESTS, correlationId);
  }
}

export class ContactUploadFailedException extends DomainException {
  constructor(readonly reason: string, correlationId: string) {
    super('Contact upload failed', HttpStatus.INTERNAL_SERVER_ERROR, correlationId);
  }
}
