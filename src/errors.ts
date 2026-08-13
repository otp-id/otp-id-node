/**
 * Error codes returned by the OTP.ID V3 API (kept in sync with the server),
 * plus INVALID_RESPONSE which is produced by the SDK itself — never by the
 * server — when a response body cannot be decoded as a V3 JSON envelope.
 */
export const ErrorCodes = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_CHANNEL: 'INVALID_CHANNEL',
  INVALID_NUMBER: 'INVALID_NUMBER',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  OTP_NOT_FOUND: 'OTP_NOT_FOUND',
  DUPLICATE_EXTERNAL_ID: 'DUPLICATE_EXTERNAL_ID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
  ALREADY_USED: 'ALREADY_USED',
  RATE_LIMITED: 'RATE_LIMITED',
  DESTINATION_RATE_LIMITED: 'DESTINATION_RATE_LIMITED',
  CHANNEL_UNAVAILABLE: 'CHANNEL_UNAVAILABLE',
  IP_NOT_ALLOWED: 'IP_NOT_ALLOWED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
} as const;

/** A known OTP.ID API error code (see {@link ErrorCodes}). */
export type ErrorCode = keyof typeof ErrorCodes;

/**
 * APIError is thrown for any non-success API response, and for
 * SDK-detected transport/decoding failures (code `INVALID_RESPONSE`).
 * Match it with `instanceof APIError` and switch on `code`.
 */
export class APIError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(`${code}: ${message} (http ${httpStatus})`);
    this.name = 'APIError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

/** Thrown by {@link parseVerifiedEvent} when the webhook signature does not match. */
export class InvalidSignatureError extends Error {
  constructor(message = 'invalid webhook signature') {
    super(message);
    this.name = 'InvalidSignatureError';
  }
}

/**
 * Thrown by {@link parseVerifiedEvent} when the webhook timestamp is not a
 * numeric unix timestamp within tolerance of the local clock (anti-replay).
 */
export class StaleTimestampError extends Error {
  constructor(message = 'webhook timestamp outside tolerance') {
    super(message);
    this.name = 'StaleTimestampError';
  }
}

/**
 * Thrown by {@link parseVerifiedEvent} when the decoded webhook payload's
 * `event` field is not `"otp.verified"`.
 */
export class UnexpectedEventError extends Error {
  constructor(message = 'unexpected webhook event') {
    super(message);
    this.name = 'UnexpectedEventError';
  }
}
