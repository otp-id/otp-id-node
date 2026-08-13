/**
 * Verification and parsing for the `otp.verified` webhook.
 *
 * The OTP.ID API signs every webhook delivery with
 * `hex(HMAC-SHA256(secret, timestamp + "." + body))`, sent as the
 * `X-OTPID-Signature` header alongside the raw unix timestamp in
 * `X-OTPID-Timestamp`. Always verify the signature (constant-time) before
 * trusting the payload, and reject stale deliveries to guard against replay.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  APIError,
  ErrorCodes,
  InvalidSignatureError,
  StaleTimestampError,
  UnexpectedEventError,
} from './errors.js';
import type { VerifiedEvent } from './types.js';

/**
 * Default maximum accepted clock difference, in seconds, between the
 * `X-OTPID-Timestamp` header and the local clock (anti-replay). Override
 * per call via {@link ParseVerifiedEventOptions.toleranceSeconds}.
 */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** Options accepted by {@link parseVerifiedEvent}. */
export interface ParseVerifiedEventOptions {
  /**
   * Maximum accepted clock difference in seconds, checked in both
   * directions. Default {@link WEBHOOK_TOLERANCE_SECONDS}.
   */
  toleranceSeconds?: number;
  /**
   * Test-only clock override. Returns the current time as a unix timestamp
   * in seconds. Defaults to `Math.floor(Date.now() / 1000)`.
   */
  _now?: () => number;
}

/** Returns `hex(HMAC-SHA256(secret, timestamp + "." + body))`. */
function computeWebhookSignature(
  secret: string,
  timestamp: string,
  body: string | Uint8Array,
): string {
  const mac = createHmac('sha256', secret);
  mac.update(timestamp + '.');
  mac.update(body);
  return mac.digest('hex');
}

/**
 * Reports whether `signature` matches
 * `hex(HMAC-SHA256(secret, timestamp + "." + body))`. The comparison is
 * constant-time and never throws — a length mismatch (or any other
 * malformed `signature`) simply returns `false`. Performs no timestamp
 * freshness check; use {@link parseVerifiedEvent} for the full validation.
 */
export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  body: string | Uint8Array,
  signature: string,
): boolean {
  const expected = computeWebhookSignature(secret, timestamp, body);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * Validates an incoming `otp.verified` webhook delivery and returns its
 * payload. Checks, strictly in order: the signature (constant-time), the
 * timestamp freshness (`±toleranceSeconds`, anti-replay), then decodes the
 * body and its `event` field. Pass the raw request body and the
 * `X-OTPID-Timestamp` / `X-OTPID-Signature` header values unmodified.
 *
 * @throws {InvalidSignatureError} `signature` does not match the payload.
 * @throws {StaleTimestampError} `timestamp` is not a numeric unix
 * timestamp, or falls outside `toleranceSeconds` of the local clock in
 * either direction.
 * @throws {APIError} (code `INVALID_RESPONSE`, `httpStatus` 0) `body` is
 * not valid JSON.
 * @throws {UnexpectedEventError} the decoded payload's `event` field is
 * not `"otp.verified"`.
 */
export function parseVerifiedEvent(
  secret: string,
  timestamp: string,
  signature: string,
  body: string | Uint8Array,
  options: ParseVerifiedEventOptions = {},
): VerifiedEvent {
  if (!verifyWebhookSignature(secret, timestamp, body, signature)) {
    throw new InvalidSignatureError();
  }

  const trimmed = timestamp.trim();
  const ts = /^[+-]?\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  const toleranceSeconds = options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  const now = options._now ?? (() => Math.floor(Date.now() / 1000));
  if (!Number.isSafeInteger(ts) || Math.abs(now() - ts) > toleranceSeconds) {
    throw new StaleTimestampError();
  }

  const bodyStr = typeof body === 'string' ? body : Buffer.from(body).toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyStr);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new APIError(
      ErrorCodes.INVALID_RESPONSE,
      `failed to decode webhook payload: ${message}`,
      0,
    );
  }

  const event = parsed as VerifiedEvent;
  if (event.event !== 'otp.verified') {
    throw new UnexpectedEventError(`unexpected webhook event: "${event.event}"`);
  }
  return event;
}
