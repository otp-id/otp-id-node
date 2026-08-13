import { describe, expect, it } from 'vitest';
import {
  APIError,
  ErrorCodes,
  InvalidSignatureError,
  StaleTimestampError,
  UnexpectedEventError,
} from './errors.js';

describe('ErrorCodes', () => {
  it('has exactly 16 codes matching the API contract (15 server + INVALID_RESPONSE)', () => {
    expect(Object.keys(ErrorCodes)).toHaveLength(16);
  });

  it('has values matching keys (kept in sync with the server)', () => {
    const expected = {
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
    };
    expect(ErrorCodes).toEqual(expected);
  });
});

describe('APIError', () => {
  it('formats the message as "CODE: message (http N)"', () => {
    const err = new APIError(ErrorCodes.INSUFFICIENT_BALANCE, 'saldo tidak cukup', 402);
    expect(err.message).toBe('INSUFFICIENT_BALANCE: saldo tidak cukup (http 402)');
  });

  it('exposes code, httpStatus and details', () => {
    const err = new APIError(ErrorCodes.DUPLICATE_EXTERNAL_ID, 'duplicate', 409, {
      existing_otp_id: 'OTP20260807ABCD000001',
    });
    expect(err.code).toBe('DUPLICATE_EXTERNAL_ID');
    expect(err.httpStatus).toBe(409);
    expect(err.details).toEqual({ existing_otp_id: 'OTP20260807ABCD000001' });
  });

  it('leaves details undefined when not provided', () => {
    const err = new APIError(ErrorCodes.OTP_EXPIRED, 'expired', 422);
    expect(err.details).toBeUndefined();
  });

  it('sets name to APIError and is an instance of Error and APIError', () => {
    const err = new APIError(ErrorCodes.UNAUTHORIZED, 'nope', 401);
    expect(err.name).toBe('APIError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(APIError);
  });
});

describe('webhook error classes', () => {
  it('InvalidSignatureError sets name and is an instance of Error', () => {
    const err = new InvalidSignatureError();
    expect(err.name).toBe('InvalidSignatureError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(InvalidSignatureError);
  });

  it('StaleTimestampError sets name and is an instance of Error', () => {
    const err = new StaleTimestampError();
    expect(err.name).toBe('StaleTimestampError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StaleTimestampError);
  });

  it('UnexpectedEventError sets name and is an instance of Error', () => {
    const err = new UnexpectedEventError();
    expect(err.name).toBe('UnexpectedEventError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(UnexpectedEventError);
  });

  it('webhook error classes accept an optional custom message', () => {
    const err = new UnexpectedEventError('unexpected webhook event: "some.event"');
    expect(err.message).toBe('unexpected webhook event: "some.event"');
  });
});
