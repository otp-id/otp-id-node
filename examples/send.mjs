// Example: sendOtp — you generate the code yourself and OTP.ID only
// delivers it (POST /v3/send). Supported delivery channels: whatsapp, sms,
// email.
//
// Mirrors the docs cURL:
//
//   curl -X POST https://api.otp.id/v3/send \
//     -d '{"channel": "sms", "destination": "6281234567890", "otp": "482913",
//          "brand": "MyApp", "ttl": 180, "external_id": "order-8822"}'
//
// Run `npm run build` first — this example imports the built package from
// ../dist/index.js, exactly as an installed `@otp-id/sdk` consumer would.
import { randomInt } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { OtpIdClient, APIError } from '../dist/index.js';

const apiKey = process.env.OTPID_API_KEY;
const destination = process.env.OTPID_DESTINATION;
if (!apiKey || !destination) {
  console.error('set OTPID_API_KEY and OTPID_DESTINATION first');
  process.exit(1);
}

function fatalApi(err) {
  if (err instanceof APIError) {
    console.error(`api error: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
}

// Generate our own 6-digit code — with sendOtp, code generation and storage
// are the caller's responsibility; OTP.ID only delivers it.
const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

const client = new OtpIdClient(apiKey);

try {
  const res = await client.sendOtp(code, {
    channel: 'sms',
    destination,
    brand: 'MyApp',
    ttl: 180,
    external_id: 'order-8822',
  });
  console.log(`sent our own code: otp_id=${res.otp_id} status=${res.status} price=${res.price}`);

  const rl = createInterface({ input, output });
  const entered = await rl.question('enter the code the user received: ');
  rl.close();

  // Verification still goes through OTP.ID — it stored a hash of the code
  // it delivered, so verifyOtp works exactly like with requestOtp.
  const v = await client.verifyOtp(res.otp_id, entered.trim());
  console.log(v.verified ? 'verified!' : `wrong code: ${v.reason}`);
} catch (err) {
  fatalApi(err);
}
