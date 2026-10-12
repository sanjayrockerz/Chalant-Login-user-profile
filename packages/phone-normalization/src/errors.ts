export type NormalizationErrorCode =
  | 'INVALID_INPUT'
  | 'COUNTRY_UNDETERMINED'
  | 'INVALID_NUMBER'
  | 'SERVICE_NUMBER'
  | 'RATE_LIMITED';

export class NormalizationError extends Error {
  public readonly code: NormalizationErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(code: NormalizationErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = 'NormalizationError';
  }
}
