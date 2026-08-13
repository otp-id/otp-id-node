// Example: WhatsApp Inbound — the USER sends a WhatsApp message to OTP.ID
// instead of typing a code. There is nothing to verify manually: OTP.ID
// matches the incoming message to the transaction automatically. This
// example polls GET /v3/otp/{otp_id} every 3 seconds, up to 5 minutes,
// until the status becomes "verified".
//
// Mirrors the docs cURL:
//
//   curl -X POST https://api.otp.id/v3/request \
//     -d '{"channel": "whatsapp_inbound", "brand": "MyApp", "ttl": 300}'
//
// Do NOT call verifyOtp for this channel — inbound transactions carry no
// code, so any submission counts as a failed attempt. In production,
// prefer the otp.verified webhook over polling (see the root README).
//
// Run `npm run build` first — this example imports the built package from
// ../dist/index.js, exactly as an installed `@otp-id/sdk` consumer would.
import { OtpIdClient, APIError } from '../dist/index.js';

const apiKey = process.env.OTPID_API_KEY;
if (!apiKey) {
  console.error('set OTPID_API_KEY first');
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const client = new OtpIdClient(apiKey);

try {
  const res = await client.requestOtp({
    channel: 'whatsapp_inbound',
    brand: 'MyApp',
    ttl: 300,
  });
  if (!res.verification) {
    console.error('expected a verification block for whatsapp_inbound');
    process.exit(1);
  }
  console.log(`created: otp_id=${res.otp_id} status=${res.status}`);
  console.log('ask the user to tap this link and send the pre-filled message:');
  console.log(`  ${res.verification.wa_link}`);
  console.log(
    `(or message ${JSON.stringify(res.verification.message)} to ${res.verification.wa_number} ` +
      `— valid until ${res.verification.expires_at})`,
  );

  console.log("waiting for the user's WhatsApp message...");
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(3_000);
    const st = await client.otpStatus(res.otp_id);
    if (st.status === 'verified') {
      console.log('verified at', st.verified_at);
      process.exit(0);
    }
  }
  console.log('timed out — the user never sent the message');
} catch (err) {
  fatalApi(err);
}
