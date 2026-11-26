# Upgrading

## From 0.1.x to 0.2.0

### How to upgrade

```bash
npm install @otp-id/sdk@^0.2.0
```

### Breaking changes

None. Every change in 0.2.0 is additive: new optional fields on existing
result types and new exports. Code written against 0.1.x compiles and behaves
the same. The only runtime difference is the `User-Agent` header, which now
reports `otp-id-node/0.2.0`.

### What's new

#### Delivery failure reason: `result.failure`

When `status` is `'failed'`, `requestOtp`, `sendOtp`, and `otpStatus` now
include a `failure` block (`DeliveryFailure`) with a machine-readable `code`
and a ready-to-show (Indonesian) `message`. A failed delivery is still not an
exception; the promise resolves normally.

```ts
import { FailureCodes, type DeliveryFailure } from '@otp-id/sdk';

const res = await client.requestOtp({ channel: 'whatsapp', destination });
if (res.status === 'failed') {
  const failure: DeliveryFailure | undefined = res.failure;
  switch (failure?.code) {
    case FailureCodes.NUMBER_NOT_ON_WHATSAPP:
      // offer SMS instead
      break;
    case FailureCodes.TOO_FREQUENT:
      // ask the user to wait before retrying
      break;
    default:
      console.log(failure?.message);
  }
}
```

`FailureCode` is the union of the known codes plus an open string, so a code
the server adds later still type-checks. Always keep a `default` branch.

#### `otpStatus` returns `verification` for pending `whatsapp_inbound`

While a `whatsapp_inbound` transaction is `pending` and not yet expired,
`otpStatus` now returns the same `verification` block as `requestOtp`
(`wa_number`, `message`, `wa_link`, `expires_at`). A client that polls or
reloads the page can recover the WhatsApp link without storing it:

```ts
const status = await client.otpStatus(otpId);
if (status.status === 'pending' && status.verification?.wa_link) {
  showWhatsAppButton(status.verification.wa_link);
}
```

#### `whatsapp_inbound` billing: pay only when verified

This is a server-side change; the SDK types and docs now describe it.

- A `whatsapp_inbound` transaction is charged only when it becomes
  `verified`.
- It stays `pending` while waiting for the user's WhatsApp message.
- It can end as `expired` (`expires_at` passed without a match). Expired
  transactions are not charged.
- `price` on the request result is the amount charged on verification;
  `last_balance` is unchanged at request time.
- A message from a number other than the bound `destination` is rejected and
  the transaction stays `pending`.

If you poll instead of using the `otp.verified` webhook, stop on any terminal
status:

```ts
const res = await client.requestOtp({ channel: 'whatsapp_inbound' });
showWhatsAppButton(res.verification?.wa_link);

const TERMINAL = new Set(['verified', 'expired', 'failed']);
let status = await client.otpStatus(res.otp_id);
while (!TERMINAL.has(status.status)) {
  await new Promise((r) => setTimeout(r, 3000));
  status = await client.otpStatus(res.otp_id);
}

if (status.status === 'verified') {
  // success: charged `status.price`
} else if (status.status === 'expired') {
  // not charged; offer to start a new transaction
} else {
  console.log(status.failure?.code, status.failure?.message);
}
```

If you previously treated `last_balance` from a `whatsapp_inbound` request as
already debited, read the balance (`saldo`) from `account()` after verification
instead.
