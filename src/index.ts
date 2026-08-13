/**
 * @otp-id/sdk — Official OTP.ID SDK for Node.js/TypeScript.
 *
 * Multi-channel OTP delivery (WhatsApp, SMS, Email, Missed Call, Voice)
 * with prepaid billing, backed by the OTP.ID V3 API.
 */

export {
  APIError,
  ErrorCodes,
  InvalidSignatureError,
  StaleTimestampError,
  UnexpectedEventError,
} from './errors.js';
export type { ErrorCode } from './errors.js';

export { OtpIdClient, VERSION } from './client.js';
export type { OtpIdClientOptions } from './client.js';

export { Channels } from './types.js';
export type {
  AccountResult,
  Channel,
  CreateTopupParams,
  OrderParams,
  OrderResult,
  StatusResult,
  TopupResult,
  Verification,
  VerifiedEvent,
  VerifyResult,
} from './types.js';

export { OtpIdClient as default } from './client.js';
