# راه‌اندازی BlueTap

## وضعیت Production

BlueTap به‌صورت یک Cloudflare Worker واحد Deploy می‌شود. Worker هم API و Webhook تلگرام را اجرا می‌کند و هم خروجی `apps/web/dist` را به‌عنوان Mini App سرو می‌کند.

- Bot: `@bluecoinxbot`
- Production URL: `https://bluetap.hazhanhasani4268-0f9.workers.dev`
- D1 database: `bluetap`
- `ALLOW_DEV_AUTH=false` در Production
- `ALLOWED_ORIGIN=https://bluetap.hazhanhasani4268-0f9.workers.dev`

## Secretهای لازم

این مقادیر فقط باید به‌عنوان Secret نگهداری شوند و نباید داخل GitHub یا Frontend قرار بگیرند:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
CLOUDFLARE_API_TOKEN       # GitHub Actions
CLOUDFLARE_ACCOUNT_ID      # GitHub Actions
```

## Deploy

Push روی `main`، Workflow `BlueTap CI/CD` را اجرا می‌کند:

1. `npm ci`
2. تست‌های امنیتی Regression
3. Typecheck
4. Build Mini App
5. اعمال D1 migrations
6. Deploy Worker + assets
7. Smoke test روی `/health` و `tonconnect-manifest.json`

برای Deploy دستی:

```bash
npm ci
npm test
npm run typecheck
npm run build
npx wrangler d1 migrations apply bluetap --remote --config apps/api/wrangler.toml
npx wrangler deploy --config apps/api/wrangler.toml
```

## Telegram

Webhook باید به این مسیر اشاره کند:

```text
https://bluetap.hazhanhasani4268-0f9.workers.dev/telegram/webhook
```

در BotFather، Menu Button / Mini App URL نیز باید روی Production URL تنظیم شود.

## TON Connect

`apps/web/public/tonconnect-manifest.json` روی Production URL تنظیم شده است. اتصال ساده کیف پول فقط آدرس را ثبت می‌کند و به‌عنوان اثبات مالکیت یا شرط دریافت BLUEX استفاده نمی‌شود.

## Claim واقعی BLUEX

Claim واقعی همچنان قفل است. قبل از فعال‌سازی باید TON Proof، خزانه امن/Multisig، سقف Season، سیاست ضد Sybil، محدودیت برداشت و Idempotency نهایی شوند.
