# BlueTap

BlueTap is the Telegram Mini App game for the BlueCoin ecosystem.

- Token: **BlueCoin (BLUEX)**
- Network: **TON**
- Jetton master: `EQCUcgi1T0zSOvRIIM4ucj83GI2xqTxrLhaAlwaH8tOw9oTJ`
- Game rewards use **off-chain Blue Points**. The app does **not** mint BLUEX and Season 1 claim is intentionally disabled until distribution rules and treasury security are finalized.

## MVP

- Telegram Mini App authentication with signed `initData`
- Tap-to-earn Blue Points with server-side energy and token-bucket anti-abuse
- Daily reward
- Referral attribution
- Verifiable in-game tasks
- Leaderboard
- TON wallet connection with TON Connect
- D1 persistence
- Cloudflare Worker API
- Mobile-first Persian UI

## Structure

```text
apps/web   Vite + React Telegram Mini App
apps/api   Cloudflare Worker + D1 API
docs       setup, architecture and economy notes
```

## Quick start

```bash
npm install
npm run dev:api
npm run dev:web
```

Read `docs/SETUP_FA.md` before deploying. Never put the Telegram bot token, wallet seed phrase or treasury private key in the frontend or GitHub repository.
