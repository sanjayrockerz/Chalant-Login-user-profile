import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENCY_KEY = 'idempotency';

/**
 * Decorator to mark endpoints that require idempotency keys
 * @param required - Whether idempotency key is required (default: false)
 */
export const Idempotent = (required: boolean = false) => SetMetadata(IDEMPOTENCY_KEY, { required });

/**
 * Decorator for endpoints that require idempotency keys
 */
export const RequireIdempotency = () => Idempotent(true);