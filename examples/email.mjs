// Example: Email OTP — server-generated code delivered by email, then verify.
//
// Mirrors the docs cURL:
//
//   curl -X POST https://api.otp.id/v3/request \
//     -d '{"channel": "email", "destination": "user@example.com", "brand": "MyApp"}'
//
// Set OTPID_DESTINATION to the recipient email address for this example.
//
// Run `npm run build` first — this example imports the built package from
// ../dist/index.js, exactly as an installed `@otp-id/sdk` consumer would.
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { OtpIdClient, APIError } from '../dist/index.js';

const apiKey = process.env.OTPID_API_KEY;
const destination = process.env.OTPID_DESTINATION;
if (!apiKey || !destination) {
  console.error('set OTPID_API_KEY and OTPID_DESTINATION (an email address) first');
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
    channel: 'email',
    destination,
    brand: 'MyApp',
  });
  console.log(
    `sent: otp_id=${res.otp_id} status=${res.status} price=${res.price} last_balance=${res.last_balance}`,
  );

  const rl = createInterface({ input, output });
  const code = await rl.question('enter the code from the email: ');
  rl.close();

  const v = await client.verifyOtp(res.otp_id, code.trim());
  console.log(v.verified ? 'verified!' : `wrong code: ${v.reason}`);
} catch (err) {
  fatalApi(err);
}
