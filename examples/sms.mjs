// Example: SMS OTP — server-generated code, then verify.
//
// Mirrors the docs cURL:
//
//   curl -X POST https://api.otp.id/v3/request \
//     -d '{"channel": "sms", "destination": "6281234567890", "brand": "MyApp", "ttl": 300}'
//
// Run `npm run build` first — this example imports the built package from
// ../dist/index.js, exactly as an installed `@otp-id/sdk` consumer would.
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

const client = new OtpIdClient(apiKey);

try {
  const res = await client.requestOtp({
    channel: 'sms',
    destination,
    brand: 'MyApp',
    ttl: 300,
  });
  console.log(
    `sent: otp_id=${res.otp_id} status=${res.status} price=${res.price} last_balance=${res.last_balance}`,
  );

  const rl = createInterface({ input, output });
  const code = await rl.question('enter the code the user received via SMS: ');
  rl.close();

  const v = await client.verifyOtp(res.otp_id, code.trim());
  console.log(v.verified ? 'verified!' : `wrong code: ${v.reason}`);
} catch (err) {
  fatalApi(err);
}
