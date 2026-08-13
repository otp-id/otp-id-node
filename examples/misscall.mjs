// Example: Missed Call OTP — the code is the last digits of the number
// that calls the user, then verify.
//
// Mirrors the docs cURL:
//
//   curl -X POST https://api.otp.id/v3/request \
//     -d '{"channel": "misscall", "destination": "6281234567890"}'
//
// Notes: brand is not needed (no message body), and otp_length has no
// effect — the code length is set by the telephony vendor. The response's
// verification.prefix is the calling number MINUS the code digits, so the
// UI can render "628559263-____" and ask the user to complete it from
// their missed-call log.
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
    channel: 'misscall',
    destination,
  });
  console.log(`calling: otp_id=${res.otp_id} status=${res.status} price=${res.price}`);
  if (res.verification) {
    console.log(
      `the incoming call number starts with: ${res.verification.prefix} ` +
        `(complete the last ${res.verification.otp_length} digits)`,
    );
  }

  const rl = createInterface({ input, output });
  const code = await rl.question('enter the LAST digits of the number that called: ');
  rl.close();

  const v = await client.verifyOtp(res.otp_id, code.trim());
  console.log(v.verified ? 'verified!' : `wrong digits: ${v.reason}`);
} catch (err) {
  fatalApi(err);
}
