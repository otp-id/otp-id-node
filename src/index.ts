/**
 * @otp-id/sdk — Official OTP.ID SDK for Node.js/TypeScript.
 *
 * Multi-channel OTP delivery (WhatsApp, SMS, Email, Missed Call, Voice)
 * with prepaid billing, backed by the OTP.ID V3 API.
 */

export const SDK_VERSION = '0.1.0';

export {
  APIError,
  ErrorCodes,
  InvalidSignatureError,
  StaleTimestampError,
  UnexpectedEventError,
} from './errors.js';
export type { ErrorCode } from './errors.js';
