# BlueTap architecture

## Trust boundaries

The browser/Mini App is untrusted. Points, energy, referrals, tasks and future BLUEX claims are decided by the Worker.

Telegram identity is verified from signed Mini App `initData`. The Worker rejects old/replayed sessions according to `AUTH_MAX_AGE_SECONDS`.

Tap traffic is rate-limited with a server-side token bucket and energy balance. The client only renders optimistic feedback.

## Data flow

Telegram -> React Mini App -> Cloudflare Worker -> D1

TON Connect stays client-side for wallet connection. The MVP records the connected address, but this is **not sufficient proof of wallet ownership for token distribution**. Before enabling BLUEX claims, add TON Proof verification and a dedicated treasury signer/multisig flow.

## Token separation

`Blue Points` are game points and have no on-chain value. They are not BLUEX. A Season conversion formula can be announced later, with a hard allocation cap from the existing BLUEX supply.

The Worker has no mint key and no treasury private key.
