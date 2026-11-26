# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.2.0] - 2026-11-26

See [UPGRADING.md](https://github.com/otp-id/otp-id-node/blob/main/UPGRADING.md) for migration notes. All changes are
additive — existing fields and behavior are unchanged.

### Added

- `failure?: DeliveryFailure` on `OrderResult` and `StatusResult`, present
  when `status` is `"failed"` on `requestOtp`, `sendOtp`, and `otpStatus`.
  `DeliveryFailure` is `{ code: FailureCode, message: string }`; `FailureCode`
  is a union of the known codes (`FailureCodes`:
  `NUMBER_NOT_ON_WHATSAPP`, `TOO_FREQUENT`, `CHANNEL_UNAVAILABLE`,
  `PROVIDER_UNAVAILABLE`, `DELIVERY_FAILED`) widened with an open string so a
  future server-side code still type-checks.
- `otpStatus` now also returns the `verification` block
  (`wa_number`/`message`/`wa_link`/`expires_at`) for pending, not-yet-expired
  `whatsapp_inbound` transactions, matching the shape already returned by
  `requestOtp`/`sendOtp`.

### Changed

- Documented the new `whatsapp_inbound` billing model (server-side change):
  transactions are now charged only when they become `verified`. They stay
  `pending` while waiting for the user's WhatsApp message and can end as
  `expired` (`expires_at` passed without a match; not charged).
  `OrderResult.price` is the amount charged on verification, and
  `last_balance` is unchanged at request time. A message from a different
  number than the bound `destination` is rejected and the transaction stays
  `pending`. Doc-only in the SDK; `status` stays a plain `string`.

## [0.1.0] - 2026-08-14

### Added

- Initial release of the OTP.ID Node.js/TypeScript SDK.
- `OtpIdClient` covering all six V3 endpoints: `requestOtp`, `sendOtp`,
  `verifyOtp`, `otpStatus`, `account`, `createTopup`.
- `parseVerifiedEvent` and `verifyWebhookSignature` for the `otp.verified`
  webhook (HMAC-SHA256, constant-time comparison, ±5 minute replay
  tolerance by default, configurable via `toleranceSeconds`).
- `APIError`, `InvalidSignatureError`, `StaleTimestampError`,
  `UnexpectedEventError`, and the `ErrorCodes` constant map.
- Full TypeScript types for every wire payload — `snake_case` field names
  matching the V3 API exactly, no camelCase remapping layer.
- Dual ESM + CJS build via tsup, with bundled type declarations.
- Zero runtime dependencies; requires Node.js >= 20.
- Per-channel runnable examples: `whatsapp`, `sms`, `voice`, `email`,
  `misscall`, `whatsapp-inbound`, `send`.
