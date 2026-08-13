import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { APIError, ErrorCodes, InvalidSignatureError, StaleTimestampError, UnexpectedEventError } from './errors.js';
import { WEBHOOK_TOLERANCE_SECONDS, parseVerifiedEvent, verifyWebhookSignature } from './webhook.js';

// Known-good vector, independently precomputed (identical to otp-id-go's
// webhook_test.go — the SDKs must never drift from each other or the server):
//
//   HMAC-SHA256("whsec_testsecret", "1765700000" + "." + webhookBody)
const SECRET = 'whsec_testsecret';
const TIMESTAMP = '1765700000';
const SIGNATURE =
  '41c831b6192fa304f0564bd03bb147587119a97a579bb7a0fc12ae9b2c8ed4ca';
const BODY =
  '{"event":"otp.verified","otp_id":"OTP20260807ABCD000001","external_id":"order-8821","channel":"whatsapp","number":"6281234567890","verified_at":"2026-08-07 10:01:30"}';

/** Signs `body` with `timestamp` using an inline reference HMAC implementation. */
function sign(secret: string, timestamp: string, body: string): string {
  const mac = createHmac('sha256', secret);
  mac.update(timestamp + '.');
  mac.update(body);
  return mac.digest('hex');
}

describe('verifyWebhookSignature', () => {
  it('verifies the known-good vector', () => {
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, BODY, SIGNATURE)).toBe(true);
  });

  it('matches an inline reference HMAC implementation (node:crypto)', () => {
    const ref = sign(SECRET, TIMESTAMP, BODY);
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, BODY, ref)).toBe(true);
    expect(ref).toBe(SIGNATURE);
  });

  it('rejects a wrong secret', () => {
    expect(verifyWebhookSignature('other-secret', TIMESTAMP, BODY, SIGNATURE)).toBe(false);
  });

  it('rejects a wrong timestamp', () => {
    expect(verifyWebhookSignature(SECRET, '1765700001', BODY, SIGNATURE)).toBe(false);
  });

  it('rejects a tampered body', () => {
    const tampered = '{"event":"otp.verified","otp_id":"HACKED"}';
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, tampered, SIGNATURE)).toBe(false);
  });

  it('rejects a wrong signature', () => {
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, BODY, 'deadbeef')).toBe(false);
  });

  it('never throws on a malformed (length-mismatched) signature', () => {
    expect(() => verifyWebhookSignature(SECRET, TIMESTAMP, BODY, '')).not.toThrow();
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, BODY, '')).toBe(false);
  });

  it('accepts a Uint8Array body identically to the equivalent string', () => {
    const bytes = new TextEncoder().encode(BODY);
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, bytes, SIGNATURE)).toBe(true);
  });
});

describe('parseVerifiedEvent', () => {
  it('parses all fields on a valid, fresh delivery', () => {
    const event = parseVerifiedEvent(SECRET, TIMESTAMP, SIGNATURE, BODY, {
      _now: () => 1765700000 + 30,
    });
    expect(event).toEqual({
      event: 'otp.verified',
      otp_id: 'OTP20260807ABCD000001',
      external_id: 'order-8821',
      channel: 'whatsapp',
      number: '6281234567890',
      verified_at: '2026-08-07 10:01:30',
    });
  });

  it('throws InvalidSignatureError for a wrong secret', () => {
    expect(() =>
      parseVerifiedEvent('other-secret', TIMESTAMP, SIGNATURE, BODY, {
        _now: () => 1765700000,
      }),
    ).toThrow(InvalidSignatureError);
  });

  it('throws StaleTimestampError 6 minutes after the signed timestamp', () => {
    expect(() =>
      parseVerifiedEvent(SECRET, TIMESTAMP, SIGNATURE, BODY, {
        _now: () => 1765700000 + 6 * 60,
      }),
    ).toThrow(StaleTimestampError);
  });

  it('throws StaleTimestampError 6 minutes before the signed timestamp (clock skew guard applies both ways)', () => {
    expect(() =>
      parseVerifiedEvent(SECRET, TIMESTAMP, SIGNATURE, BODY, {
        _now: () => 1765700000 - 6 * 60,
      }),
    ).toThrow(StaleTimestampError);
  });

  it('throws StaleTimestampError for a non-numeric timestamp', () => {
    const ts = 'not-a-number';
    const sig = sign(SECRET, ts, BODY);
    expect(() =>
      parseVerifiedEvent(SECRET, ts, sig, BODY, { _now: () => 1765700000 }),
    ).toThrow(StaleTimestampError);
  });

  it('throws APIError with code INVALID_RESPONSE and httpStatus 0 for a signed, malformed JSON body', () => {
    const body = '{not-json';
    const sig = sign(SECRET, TIMESTAMP, body);
    let caught: unknown;
    try {
      parseVerifiedEvent(SECRET, TIMESTAMP, sig, body, { _now: () => 1765700000 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(APIError);
    const apiErr = caught as APIError;
    expect(apiErr.code).toBe(ErrorCodes.INVALID_RESPONSE);
    expect(apiErr.httpStatus).toBe(0);
  });

  it('throws UnexpectedEventError carrying the actual event name for a signed otp.expired payload', () => {
    const body = '{"event":"otp.expired","otp_id":"OTP20260807ABCD000001"}';
    const sig = sign(SECRET, TIMESTAMP, body);
    let caught: unknown;
    try {
      parseVerifiedEvent(SECRET, TIMESTAMP, sig, body, { _now: () => 1765700000 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnexpectedEventError);
    expect((caught as Error).message).toContain('otp.expired');
  });

  it('honors a custom toleranceSeconds', () => {
    expect(WEBHOOK_TOLERANCE_SECONDS).toBe(300);

    // 90s past the signed timestamp: within the default 300s tolerance...
    expect(() =>
      parseVerifiedEvent(SECRET, TIMESTAMP, SIGNATURE, BODY, {
        _now: () => 1765700000 + 90,
      }),
    ).not.toThrow();

    // ...but outside a custom 60s tolerance.
    expect(() =>
      parseVerifiedEvent(SECRET, TIMESTAMP, SIGNATURE, BODY, {
        toleranceSeconds: 60,
        _now: () => 1765700000 + 90,
      }),
    ).toThrow(StaleTimestampError);

    // 45s past the signed timestamp is within a custom 60s tolerance.
    expect(() =>
      parseVerifiedEvent(SECRET, TIMESTAMP, SIGNATURE, BODY, {
        toleranceSeconds: 60,
        _now: () => 1765700000 + 45,
      }),
    ).not.toThrow();
  });

  it('checks the signature before the timestamp (signature failures win)', () => {
    // A stale timestamp AND a wrong secret: must report InvalidSignatureError,
    // not StaleTimestampError.
    expect(() =>
      parseVerifiedEvent('other-secret', TIMESTAMP, SIGNATURE, BODY, {
        _now: () => 1765700000 + 6 * 60,
      }),
    ).toThrow(InvalidSignatureError);
  });

  it('defaults _now to the real clock when omitted', () => {
    // A timestamp far in the past with no _now override must be stale
    // against the real wall clock.
    expect(() => parseVerifiedEvent(SECRET, TIMESTAMP, SIGNATURE, BODY)).toThrow(
      StaleTimestampError,
    );
  });
});
