import { APIError, ErrorCodes } from './errors.js';

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
}
