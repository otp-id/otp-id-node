import { APIError, ErrorCodes } from './errors.js';
import type {
  AccountResult,
  CreateTopupParams,
  OrderParams,
  OrderResult,
  StatusResult,
  TopupResult,
  VerifyResult,
} from './types.js';

/** SDK version, sent in the `User-Agent` header. */
export const VERSION = '0.1.0';

const DEFAULT_BASE_URL = 'https://api.otp.id';
const DEFAULT_TIMEOUT_MS = 30_000;
/** Guard against abnormal responses — mirrors the Go SDK's `io.LimitReader`. */
const MAX_BODY_CHARS = 1 << 20; // 1 MB
const MAX_SNIPPET_CHARS = 200;

/** Options accepted by the {@link OtpIdClient} constructor. */
export interface OtpIdClientOptions {
  /** Overrides the default base URL (`https://api.otp.id`). */
  baseURL?: string;
  /** Injectable `fetch` implementation, primarily for tests. */
  fetch?: typeof fetch;
  /** Request timeout in milliseconds. Default 30_000. */
  timeoutMs?: number;
}

/** Shape of the V3 envelope error block: `{code, message, details?}`. */
interface RawErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Shape of the V3 response envelope: `{success, data, error}`. */
interface RawEnvelope {
  success: boolean;
  data?: unknown;
  error?: RawErrorBody | null;
}

/**
 * Returns the first ~200 characters of a raw body for diagnostics, without
 * splitting multi-byte code points. Mirrors the Go SDK's `bodySnippet`.
 */
function bodySnippet(raw: string): string {
  const trimmed = raw.trim();
  const chars = Array.from(trimmed);
  if (chars.length > MAX_SNIPPET_CHARS) {
    return chars.slice(0, MAX_SNIPPET_CHARS).join('');
  }
  return trimmed;
}

/**
 * Returns a new object with every `undefined`-valued key removed. Used to
 * build outbound request bodies so empty optional fields (e.g. an unset
 * `OrderParams.brand`) are absent from the JSON payload rather than present
 * with a `null`/`undefined` value — mirrors the Go SDK's `json:",omitempty"`.
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Trims `otpId` and throws a synchronous {@link TypeError} (no network call)
 * when it is empty — mirrors the Go SDK's `errEmptyOtpID` fail-fast check.
 */
function requireOtpId(otpId: string): string {
  const id = otpId.trim();
  if (id === '') {
    throw new TypeError('otp-id: otp_id is empty');
  }
  return id;
}

/** Narrows `value` to a well-formed V3 envelope shape. */
function isRawEnvelope(value: unknown): value is RawEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.success !== 'boolean') {
    return false;
  }
  if (candidate.error !== undefined && candidate.error !== null) {
    if (typeof candidate.error !== 'object') {
      return false;
    }
    const error = candidate.error as Record<string, unknown>;
    if (typeof error.code !== 'string' || typeof error.message !== 'string') {
      return false;
    }
  }
  return true;
}

/**
 * OTP.ID V3 API client. Handles auth headers, timeouts, and V3 envelope
 * decoding. No automatic retries — every call is a single HTTP request.
 */
export class OtpIdClient {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(apiKey: string, options: OtpIdClientOptions = {}) {
    const trimmedKey = apiKey.trim();
    if (trimmedKey === '') {
      throw new TypeError('otp-id: api key is empty');
    }
    this.apiKey = trimmedKey;
    this.baseURL = (options.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Performs a single HTTP call (no retries) and decodes the V3 envelope.
   * Resolves with `data` when `expectData` is true (the default) and the
   * envelope succeeded; resolves with `undefined` when `expectData` is
   * false. Throws {@link APIError} for any non-success envelope or any
   * response that cannot be decoded as a V3 envelope.
   */
  private async doRequest(
    method: string,
    path: string,
    body?: unknown,
    expectData = true,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'User-Agent': `otp-id-node/${VERSION}`,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await this.fetchImpl(`${this.baseURL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    let raw = await response.text();
    if (raw.length > MAX_BODY_CHARS) {
      raw = raw.slice(0, MAX_BODY_CHARS);
    }

    const invalidResponse = (): APIError =>
      new APIError(ErrorCodes.INVALID_RESPONSE, bodySnippet(raw), response.status);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw invalidResponse();
    }

    if (!isRawEnvelope(parsed)) {
      throw invalidResponse();
    }

    if (!parsed.success) {
      if (!parsed.error) {
        throw invalidResponse();
      }
      throw new APIError(
        parsed.error.code,
        parsed.error.message,
        response.status,
        parsed.error.details,
      );
    }

    if (expectData && (parsed.data === undefined || parsed.data === null)) {
      throw invalidResponse();
    }

    return parsed.data;
  }

  /**
   * Creates an OTP transaction with a server-generated code
   * (`POST /v3/request`). The code itself is never returned.
   */
  requestOtp(params: OrderParams): Promise<OrderResult> {
    const body = stripUndefined(params as unknown as Record<string, unknown>);
    return this.doRequest('POST', '/v3/request', body) as Promise<OrderResult>;
  }

  /**
   * Delivers a client-generated code (`POST /v3/send`). The server rejects
   * the `voice` and `whatsapp_inbound` channels for this endpoint; use
   * `whatsapp`, `sms`, or `email`.
   */
  sendOtp(otp: string, params: OrderParams): Promise<OrderResult> {
    const body = stripUndefined({
      ...(params as unknown as Record<string, unknown>),
      otp,
    });
    return this.doRequest('POST', '/v3/send', body) as Promise<OrderResult>;
  }

  /**
   * Checks a user-submitted code against a transaction (`POST /v3/verify`).
   * Do not call it for `whatsapp_inbound` transactions. Throws a
   * synchronous {@link TypeError} (no network call) when `otpId` is empty
   * (after trimming).
   */
  verifyOtp(otpId: string, otp: string): Promise<VerifyResult> {
    const id = requireOtpId(otpId);
    return this.doRequest('POST', '/v3/verify', { otp_id: id, otp }) as Promise<VerifyResult>;
  }

  /**
   * Fetches the current state of a transaction
   * (`GET /v3/otp/{otp_id}`, path-escaped). Throws a synchronous
   * {@link TypeError} (no network call) when `otpId` is empty (after
   * trimming).
   */
  otpStatus(otpId: string): Promise<StatusResult> {
    const id = requireOtpId(otpId);
    return this.doRequest(
      'GET',
      `/v3/otp/${encodeURIComponent(id)}`,
    ) as Promise<StatusResult>;
  }

  /**
   * Fetches the merchant profile and credit balance for the API key in use
   * (`GET /v3/account`). Never contains credentials.
   */
  account(): Promise<AccountResult> {
    return this.doRequest('GET', '/v3/account') as Promise<AccountResult>;
  }

  /**
   * Creates a credit top-up invoice (`POST /v3/topups`). Call it from
   * server-side code only — never expose your API key to browsers or
   * mobile apps.
   */
  createTopup(params: CreateTopupParams): Promise<TopupResult> {
    const body = {
      amount: params.amount,
      payment_method_id: params.payment_method_id,
    };
    return this.doRequest('POST', '/v3/topups', body) as Promise<TopupResult>;
  }
}
