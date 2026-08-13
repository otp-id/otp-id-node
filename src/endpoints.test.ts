import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { withServer } from '../test/helpers.js';
import { OtpIdClient } from './client.js';
import { APIError, ErrorCodes } from './errors.js';
import { Channels } from './types.js';

// Fixtures copied verbatim from otp-id-go's order_test.go / verify_test.go /
// status_test.go / account_test.go / topup_test.go — the Go SDK is the
// source of truth for wire payload shapes.
const orderWhatsAppFixture =
  '{"success":true,"data":{"otp_id":"OTP20260807ABCD000001","status":"sent","channel":"whatsapp","number":"6281234567890","price":350,"last_balance":99650,"expires_at":"2026-08-07 10:05:00"},"error":null}';

const orderInboundFixture =
  '{"success":true,"data":{"otp_id":"OTP20260807ABCD000002","status":"pending","channel":"whatsapp_inbound","number":"","price":350,"last_balance":99300,"expires_at":"2026-08-07 10:05:00","verification":{"wa_number":"6285212345678","message":"OTPID V-8FK2QN9P — verifikasi MyApp. Kirim pesan ini tanpa mengubah isinya.","wa_link":"https://wa.me/6285212345678?text=OTPID%20V-8FK2QN9P","expires_at":"2026-08-07 10:05:00"}},"error":null}';

const orderMisscallFixture =
  '{"success":true,"data":{"otp_id":"OTP20260807ABCD000003","status":"sent","channel":"misscall","number":"6281234567890","price":250,"last_balance":99050,"expires_at":"2026-08-07 10:05:00","verification":{"prefix":"628559263","otp_length":4}},"error":null}';

function sendJson(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>);
}

describe('requestOtp', () => {
  it('sends the whatsapp order body and decodes the result', async () => {
    let gotPath = '';
    let gotBody: Record<string, unknown> = {};
    await withServer(
      (req, res) => {
        gotPath = req.url ?? '';
        void readJsonBody(req).then((body) => {
          gotBody = body;
          sendJson(res, 200, orderWhatsAppFixture);
        });
      },
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        const res = await client.requestOtp({
          channel: Channels.WhatsApp,
          destination: '6281234567890',
          brand: 'MyApp',
          otp_length: 6,
          ttl: 300,
          external_id: 'order-8821',
        });
        expect(res.otp_id).toBe('OTP20260807ABCD000001');
        expect(res.status).toBe('sent');
        expect(res.channel).toBe('whatsapp');
        expect(res.price).toBe(350);
        expect(res.last_balance).toBe(99650);
        expect(res.verification).toBeUndefined();
      },
    );
    expect(gotPath).toBe('/v3/request');
    expect(gotBody).toMatchObject({
      channel: 'whatsapp',
      destination: '6281234567890',
      brand: 'MyApp',
      otp_length: 6,
      ttl: 300,
      external_id: 'order-8821',
    });
    expect(gotBody.otp).toBeUndefined();
  });

  it('omits empty optional fields from the request body', async () => {
    let gotBody: Record<string, unknown> = {};
    await withServer(
      (req, res) => {
        void readJsonBody(req).then((body) => {
          gotBody = body;
          sendJson(res, 200, orderInboundFixture);
        });
      },
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        await client.requestOtp({ channel: Channels.WhatsAppInbound });
      },
    );
    for (const key of ['destination', 'brand', 'otp_length', 'ttl', 'external_id']) {
      expect(Object.prototype.hasOwnProperty.call(gotBody, key), `key ${key} must be omitted`).toBe(
        false,
      );
    }
  });

  it('decodes the whatsapp_inbound verification block', async () => {
    await withServer(
      (req, res) => sendJson(res, 200, orderInboundFixture),
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        const res = await client.requestOtp({ channel: Channels.WhatsAppInbound });
        expect(res.verification).toBeDefined();
        expect(res.verification?.wa_number).toBe('6285212345678');
        expect(res.verification?.wa_link).not.toBe('');
        expect(res.verification?.message).not.toBe('');
        expect(res.verification?.expires_at).toBe('2026-08-07 10:05:00');
      },
    );
  });

  it('decodes the misscall verification block', async () => {
    await withServer(
      (req, res) => sendJson(res, 200, orderMisscallFixture),
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        const res = await client.requestOtp({
          channel: Channels.Misscall,
          destination: '6281234567890',
        });
        expect(res.verification?.prefix).toBe('628559263');
        expect(res.verification?.otp_length).toBe(4);
      },
    );
  });

  it('throws an APIError with code INSUFFICIENT_BALANCE on HTTP 402', async () => {
    await withServer(
      (req, res) =>
        sendJson(
          res,
          402,
          '{"success":false,"data":null,"error":{"code":"INSUFFICIENT_BALANCE","message":"balance is not enough"}}',
        ),
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        await expect(
          client.requestOtp({ channel: Channels.Sms, destination: '6281234567890' }),
        ).rejects.toMatchObject({ code: ErrorCodes.INSUFFICIENT_BALANCE, httpStatus: 402 });
      },
    );
  });
});

describe('sendOtp', () => {
  it('includes the otp field alongside the order params and decodes the result', async () => {
    let gotPath = '';
    let gotBody: Record<string, unknown> = {};
    await withServer(
      (req, res) => {
        gotPath = req.url ?? '';
        void readJsonBody(req).then((body) => {
          gotBody = body;
          sendJson(res, 200, orderWhatsAppFixture);
        });
      },
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        const res = await client.sendOtp('482913', {
          channel: Channels.WhatsApp,
          destination: '6281234567890',
        });
        expect(res.otp_id).toBe('OTP20260807ABCD000001');
        expect(res.status).toBe('sent');
        expect(res.last_balance).toBe(99650);
      },
    );
    expect(gotPath).toBe('/v3/send');
    expect(gotBody).toMatchObject({
      otp: '482913',
      channel: 'whatsapp',
      destination: '6281234567890',
    });
  });
});

describe('verifyOtp', () => {
  it('sends otp_id and otp, and decodes a verified result', async () => {
    let gotBody: Record<string, unknown> = {};
    await withServer(
      (req, res) => {
        expect(req.url).toBe('/v3/verify');
        void readJsonBody(req).then((body) => {
          gotBody = body;
          sendJson(
            res,
            200,
            '{"success":true,"data":{"otp_id":"OTP20260807ABCD000001","verified":true,"reason":""},"error":null}',
          );
        });
      },
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        const res = await client.verifyOtp('OTP20260807ABCD000001', '482913');
        expect(res.verified).toBe(true);
        expect(res.reason).toBe('');
      },
    );
    expect(gotBody).toMatchObject({ otp_id: 'OTP20260807ABCD000001', otp: '482913' });
  });

  it('treats a mismatch as a normal (non-error) result', async () => {
    await withServer(
      (req, res) =>
        sendJson(
          res,
          200,
          '{"success":true,"data":{"otp_id":"OTP20260807ABCD000001","verified":false,"reason":"mismatch"},"error":null}',
        ),
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        const res = await client.verifyOtp('OTP20260807ABCD000001', '000000');
        expect(res.verified).toBe(false);
        expect(res.reason).toBe('mismatch');
      },
    );
  });

  it('throws an APIError with code OTP_EXPIRED on HTTP 422', async () => {
    await withServer(
      (req, res) =>
        sendJson(
          res,
          422,
          '{"success":false,"data":null,"error":{"code":"OTP_EXPIRED","message":"otp has expired"}}',
        ),
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        await expect(
          client.verifyOtp('OTP20260807ABCD000001', '482913'),
        ).rejects.toMatchObject({ code: ErrorCodes.OTP_EXPIRED, httpStatus: 422 });
      },
    );
  });

  it('throws a synchronous TypeError for an empty otp_id, without any network call', () => {
    let called = false;
    const fetchStub = (async () => {
      called = true;
      throw new Error('verifyOtp must not call fetch for an empty otp_id');
    }) as typeof fetch;
    const client = new OtpIdClient('test-key', { fetch: fetchStub });

    expect(() => client.verifyOtp('  ', '482913')).toThrow(TypeError);
    expect(called).toBe(false);
  });
});

describe('otpStatus', () => {
  it('performs a GET request and decodes the status result', async () => {
    let gotMethod = '';
    let gotPath = '';
    await withServer(
      (req, res) => {
        gotMethod = req.method ?? '';
        gotPath = req.url ?? '';
        sendJson(
          res,
          200,
          '{"success":true,"data":{"otp_id":"OTP20260807ABCD000001","status":"sent","channel":"whatsapp","number":"6281234567890","attempts":0,"expires_at":"2026-08-07 10:05:00","verified_at":"","price":350},"error":null}',
        );
      },
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        const res = await client.otpStatus('OTP20260807ABCD000001');
        expect(res.status).toBe('sent');
        expect(res.attempts).toBe(0);
        expect(res.verified_at).toBe('');
        expect(res.price).toBe(350);
        expect(res.verification).toBeUndefined();
      },
    );
    expect(gotMethod).toBe('GET');
    expect(gotPath).toBe('/v3/otp/OTP20260807ABCD000001');
  });

  it('decodes the misscall verification prefix', async () => {
    await withServer(
      (req, res) =>
        sendJson(
          res,
          200,
          '{"success":true,"data":{"otp_id":"OTP20260807ABCD000003","status":"sent","channel":"misscall","number":"6281234567890","attempts":1,"expires_at":"2026-08-07 10:05:00","verified_at":"","price":250,"verification":{"prefix":"628559263"}},"error":null}',
        ),
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        const res = await client.otpStatus('OTP20260807ABCD000003');
        expect(res.verification?.prefix).toBe('628559263');
      },
    );
  });

  it('path-escapes the otp_id', async () => {
    let gotPath = '';
    await withServer(
      (req, res) => {
        gotPath = req.url ?? '';
        sendJson(
          res,
          404,
          '{"success":false,"data":null,"error":{"code":"OTP_NOT_FOUND","message":"not found"}}',
        );
      },
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        await expect(client.otpStatus('weird/../id')).rejects.toBeInstanceOf(APIError);
      },
    );
    expect(gotPath).toContain('weird%2F..%2Fid');
  });

  it('throws a synchronous TypeError for an empty otp_id, without any network call', () => {
    let called = false;
    const fetchStub = (async () => {
      called = true;
      throw new Error('otpStatus must not call fetch for an empty otp_id');
    }) as typeof fetch;
    const client = new OtpIdClient('test-key', { fetch: fetchStub });

    expect(() => client.otpStatus('')).toThrow(TypeError);
    expect(called).toBe(false);
  });
});

describe('account', () => {
  it('performs a GET request and decodes the account result', async () => {
    let gotMethod = '';
    let gotPath = '';
    await withServer(
      (req, res) => {
        gotMethod = req.method ?? '';
        gotPath = req.url ?? '';
        sendJson(
          res,
          200,
          '{"success":true,"data":{"merchant_id":"M123","name":"PT Contoh","brand_name":"MyApp","brand_email":"otp@myapp.co.id","email":"owner@myapp.co.id","saldo":99650},"error":null}',
        );
      },
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        const res = await client.account();
        expect(res.merchant_id).toBe('M123');
        expect(res.brand_name).toBe('MyApp');
        expect(res.saldo).toBe(99650);
      },
    );
    expect(gotMethod).toBe('GET');
    expect(gotPath).toBe('/v3/account');
  });

  it('throws an APIError with code UNAUTHORIZED on HTTP 401', async () => {
    await withServer(
      (req, res) =>
        sendJson(
          res,
          401,
          '{"success":false,"data":null,"error":{"code":"UNAUTHORIZED","message":"invalid api key"}}',
        ),
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        await expect(client.account()).rejects.toMatchObject({
          code: ErrorCodes.UNAUTHORIZED,
          httpStatus: 401,
        });
      },
    );
  });
});

describe('createTopup', () => {
  it('sends the wire body {amount, payment_method_id} and decodes the result', async () => {
    let gotMethod = '';
    let gotPath = '';
    let gotBody: Record<string, unknown> = {};
    await withServer(
      (req, res) => {
        gotMethod = req.method ?? '';
        gotPath = req.url ?? '';
        void readJsonBody(req).then((body) => {
          gotBody = body;
          sendJson(
            res,
            200,
            '{"success":true,"data":{"topup_id":"TC20990809Q7M4X2A8BC5D6EFG","payment_url":"https://app.otp.id/topup/TC20990809Q7M4X2A8BC5D6EFG?hash=abc","payment_hash":"abc","amount":100000,"payment_total":100750,"payment_method_id":3,"payment_method":"QRIS","payment_type":"qris","payment_expired_at":"2026-08-14 12:00:00","status":"pending"},"error":null}',
          );
        });
      },
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        const res = await client.createTopup({ amount: 100000, payment_method_id: 3 });
        expect(res.topup_id).toBe('TC20990809Q7M4X2A8BC5D6EFG');
        expect(res.payment_total).toBe(100750);
        expect(res.payment_method).toBe('QRIS');
      },
    );
    expect(gotMethod).toBe('POST');
    expect(gotPath).toBe('/v3/topups');
    expect(gotBody).toEqual({ amount: 100000, payment_method_id: 3 });
  });

  it('throws an APIError with code VALIDATION_ERROR on HTTP 400', async () => {
    await withServer(
      (req, res) =>
        sendJson(
          res,
          400,
          '{"success":false,"data":null,"error":{"code":"VALIDATION_ERROR","message":"amount must be one of 10000, 100000, 500000, 1000000, 2000000"}}',
        ),
      async (baseURL) => {
        const client = new OtpIdClient('test-key', { baseURL });
        await expect(
          client.createTopup({ amount: 12345, payment_method_id: 3 }),
        ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
      },
    );
  });
});
