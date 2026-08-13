import type { ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { withServer } from '../test/helpers.js';
import { OtpIdClient, VERSION } from './client.js';
import { APIError, ErrorCodes } from './errors.js';

/** Signature of the private `doRequest` method, exposed here for tests. */
type DoRequest = (
  method: string,
  path: string,
  body?: unknown,
  expectData?: boolean,
) => Promise<unknown>;

/** Calls the private `doRequest` without weakening the class's public type. */
function callDoRequest(
  client: OtpIdClient,
  ...args: Parameters<DoRequest>
): Promise<unknown> {
  return (client as unknown as { doRequest: DoRequest }).doRequest(...args);
}

function sendJson(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

describe('OtpIdClient constructor', () => {
  it('trims the api key', async () => {
    let gotAuth = '';
    await withServer(
      (req, res) => {
        gotAuth = req.headers.authorization ?? '';
        sendJson(res, 200, '{"success":true,"data":{},"error":null}');
      },
      async (baseURL) => {
        const client = new OtpIdClient('  test-key  ', { baseURL });
        await callDoRequest(client, 'GET', '/v3/account');
      },
    );
    expect(gotAuth).toBe('Bearer test-key');
  });

  it('throws TypeError synchronously for an empty api key, without any network call', () => {
    let called = false;
    const fetchStub = (async () => {
      called = true;
      throw new Error('doRequest must not call fetch for an empty api key');
    }) as typeof fetch;

    expect(() => new OtpIdClient('', { fetch: fetchStub })).toThrow(TypeError);
    expect(() => new OtpIdClient('   ', { fetch: fetchStub })).toThrow(TypeError);
    expect(called).toBe(false);
  });

  it('trims trailing slashes from a custom base URL', async () => {
    await withServer(
      (req, res) => {
        expect(req.url).toBe('/v3/account');
        sendJson(res, 200, '{"success":true,"data":{},"error":null}');
      },
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL: `${baseURL}/` });
        const data = await callDoRequest(client, 'GET', '/v3/account');
        expect(data).toEqual({});
      },
    );
  });
});

describe('doRequest headers', () => {
  it('sends Authorization, User-Agent, and Content-Type for a body request', async () => {
    let gotAuth = '';
    let gotUA = '';
    let gotCT = '';
    await withServer(
      (req, res) => {
        gotAuth = req.headers.authorization ?? '';
        gotUA = req.headers['user-agent'] ?? '';
        gotCT = req.headers['content-type'] ?? '';
        sendJson(res, 200, '{"success":true,"data":{},"error":null}');
      },
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        await callDoRequest(client, 'POST', '/v3/request', { a: 'b' });
      },
    );
    expect(gotAuth).toBe('Bearer test-key');
    expect(gotUA).toBe(`otp-id-node/${VERSION}`);
    expect(gotCT).toBe('application/json');
  });

  it('does not send Content-Type for a GET request without a body', async () => {
    let gotCT: string | undefined = 'unset';
    await withServer(
      (req, res) => {
        gotCT = req.headers['content-type'];
        sendJson(res, 200, '{"success":true,"data":{},"error":null}');
      },
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        await callDoRequest(client, 'GET', '/v3/account');
      },
    );
    expect(gotCT).toBeUndefined();
  });
});

describe('doRequest envelope decoding', () => {
  it('returns data on a success envelope', async () => {
    await withServer(
      (req, res) => sendJson(res, 200, '{"success":true,"data":{"otp_id":"OTP1"},"error":null}'),
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        const data = await callDoRequest(client, 'GET', '/v3/otp/OTP1');
        expect(data).toEqual({ otp_id: 'OTP1' });
      },
    );
  });

  it('throws APIError with code, httpStatus, and details on a DUPLICATE_EXTERNAL_ID response', async () => {
    await withServer(
      (req, res) =>
        sendJson(
          res,
          409,
          '{"success":false,"data":null,"error":{"code":"DUPLICATE_EXTERNAL_ID","message":"external_id already used","details":{"existing_otp_id":"OTP20260807ABCD000001"}}}',
        ),
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        await expect(callDoRequest(client, 'POST', '/v3/request', {})).rejects.toMatchObject({
          code: ErrorCodes.DUPLICATE_EXTERNAL_ID,
          httpStatus: 409,
          details: { existing_otp_id: 'OTP20260807ABCD000001' },
        });
      },
    );
  });

  it('throws APIError with code INVALID_RESPONSE and a body snippet for a non-JSON response', async () => {
    await withServer(
      (req, res) => {
        res.writeHead(502, { 'Content-Type': 'text/html' });
        res.end('<html>502 Bad Gateway</html>');
      },
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        let caught: unknown;
        try {
          await callDoRequest(client, 'GET', '/v3/account');
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(APIError);
        const apiErr = caught as APIError;
        expect(apiErr.code).toBe(ErrorCodes.INVALID_RESPONSE);
        expect(apiErr.httpStatus).toBe(502);
        expect(apiErr.message).toContain('502 Bad Gateway');
      },
    );
  });

  it('throws APIError INVALID_RESPONSE when success is false and error is null', async () => {
    await withServer(
      (req, res) => sendJson(res, 500, '{"success":false,"data":null,"error":null}'),
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        await expect(callDoRequest(client, 'GET', '/v3/account')).rejects.toMatchObject({
          code: ErrorCodes.INVALID_RESPONSE,
        });
      },
    );
  });

  it('throws APIError INVALID_RESPONSE when success is true and data is null but data is expected', async () => {
    await withServer(
      (req, res) => sendJson(res, 200, '{"success":true,"data":null,"error":null}'),
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        await expect(callDoRequest(client, 'GET', '/v3/account')).rejects.toMatchObject({
          code: ErrorCodes.INVALID_RESPONSE,
        });
      },
    );
  });

  it('does not require data when expectData is false', async () => {
    await withServer(
      (req, res) => sendJson(res, 200, '{"success":true,"data":null,"error":null}'),
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        const data = await callDoRequest(client, 'GET', '/v3/account', undefined, false);
        expect(data).toBeNull();
      },
    );
  });
});

describe('doRequest timeout', () => {
  it('rejects when the server exceeds the configured timeout', async () => {
    await withServer(
      (req, res) => {
        setTimeout(() => sendJson(res, 200, '{"success":true,"data":{},"error":null}'), 300);
      },
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL, timeoutMs: 20 });
        await expect(callDoRequest(client, 'GET', '/v3/account')).rejects.toBeTruthy();
      },
    );
  });
});
