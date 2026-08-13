/**
 * Wire types for the OTP.ID V3 API.
 *
 * Every interface here mirrors the JSON payloads exactly — field names stay
 * `snake_case` (matching the wire format and the public API docs) rather
 * than being remapped to `camelCase`. This keeps the SDK a thin, zero-drift
 * pass-through: no field-mapping layer to keep in sync with the server.
 */

/** OTP delivery channel accepted by the V3 API. */
export type Channel =
  | 'whatsapp'
  | 'sms'
  | 'voice'
  | 'email'
  | 'misscall'
  | 'whatsapp_inbound';

/** Named constants for every {@link Channel} value. */
export const Channels = {
  WhatsApp: 'whatsapp',
  Sms: 'sms',
  Voice: 'voice',
  Email: 'email',
  Misscall: 'misscall',
  WhatsAppInbound: 'whatsapp_inbound',
} as const satisfies Record<string, Channel>;

/** Request body for `requestOtp` (POST /v3/request) and `sendOtp` (POST /v3/send). */
export interface OrderParams {
  /** Selects the delivery channel. Required. */
  channel: Channel;
  /**
   * Phone number (digits only) or email address. Required for every
   * channel except `whatsapp_inbound`.
   */
  destination?: string;
  /**
   * Overrides the merchant `brand_name` shown in the OTP message.
   * Required by the server for the `voice` channel.
   */
  brand?: string;
  /**
   * Generated code length. Server default 6, clamped 4-8. The server
   * forces 4 for the `voice` channel.
   */
  otp_length?: number;
  /** OTP validity in seconds. Server default 300, clamped 60-900. */
  ttl?: number;
  /** Optional merchant-side idempotency key. */
  external_id?: string;
}

/**
 * Flat superset of the per-channel `verification` response block. Which
 * fields are set depends on the channel: `whatsapp_inbound` fills
 * `wa_number`/`message`/`wa_link`/`expires_at`; `misscall` fills `prefix`
 * (and `otp_length` on order responses). All other channels have no
 * verification block at all (`undefined`).
 */
export interface Verification {
  wa_number?: string;
  message?: string;
  wa_link?: string;
  expires_at?: string;
  prefix?: string;
  otp_length?: number;
}

/** Success payload of POST /v3/request and POST /v3/send. */
export interface OrderResult {
  otp_id: string;
  /** `pending` | `sent` | `success` | `failed` */
  status: string;
  channel: Channel;
  number: string;
  price: number;
  /**
   * Remaining credit after this transaction. Stays unchanged when delivery
   * failed (`status: "failed"`) or on an idempotency replay.
   */
  last_balance: number;
  /**
   * `"YYYY-MM-DD HH:MM:SS"` in WIB (UTC+7). Kept as a string — the SDK does
   * not parse server datetimes.
   */
  expires_at: string;
  verification?: Verification;
}

/** Success payload of POST /v3/verify. */
export interface VerifyResult {
  otp_id: string;
  verified: boolean;
  /**
   * `""` when `verified` is true, `"mismatch"` when the code was wrong. A
   * mismatch is HTTP 200 and therefore NOT an error. Expired / locked /
   * already-used transactions come back as an `APIError` (`OTP_EXPIRED`,
   * `TOO_MANY_ATTEMPTS`, `ALREADY_USED`) instead.
   */
  reason: string;
}

/** Success payload of GET /v3/otp/{otp_id}. */
export interface StatusResult {
  otp_id: string;
  /** `sent` | `success` | `failed` | `pending` | `verified` */
  status: string;
  channel: Channel;
  number: string;
  attempts: number;
  expires_at: string;
  /** `""` until verified. */
  verified_at: string;
  price: number;
  /**
   * Only present for not-yet-verified misscall transactions (`prefix`
   * field), so polling clients can build their UI.
   */
  verification?: Verification;
}

/** Success payload of GET /v3/account. Never contains credentials. */
export interface AccountResult {
  merchant_id: string;
  name: string;
  brand_name: string;
  brand_email: string;
  email: string;
  /** Current credit balance. */
  saldo: number;
}

/** Request body for `createTopup` (POST /v3/topups). */
export interface CreateTopupParams {
  /**
   * Credit package in rupiah. The server accepts exactly: 10000, 100000,
   * 500000, 1000000, 2000000.
   */
  amount: number;
  /** Selects the payment method for the invoice. */
  payment_method_id: number;
}

/**
 * Success payload of POST /v3/topups. `payment_url` is a signed OTP.ID
 * payment page that opens without a dashboard login.
 */
export interface TopupResult {
  topup_id: string;
  payment_url: string;
  payment_hash: string;
  amount: number;
  /** `amount` + admin fee; display as-is. */
  payment_total: number;
  payment_method_id: number;
  payment_method: string;
  payment_type: string;
  payment_expired_at: string;
  status: string;
}

/** Payload of the `otp.verified` webhook. */
export interface VerifiedEvent {
  /** Always `"otp.verified"`. */
  event: string;
  otp_id: string;
  /** `""` when the merchant sent no `external_id`. */
  external_id: string;
  channel: Channel;
  number: string;
  /** `"YYYY-MM-DD HH:MM:SS"` WIB. */
  verified_at: string;
}
