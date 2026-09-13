# راه‌اندازی BlueTap

## ۱. Bot تلگرام

ربات پروژه ساخته شده است:

- Username: `@bluecoinxbot`
- Link: `https://t.me/bluecoinxbot`

Bot Token را فقط به‌عنوان Secret در Cloudflare ذخیره کن و هرگز داخل GitHub یا Frontend قرار نده.

بعد از Deploy شدن Mini App، از BotFather برای همین ربات یک Menu Button / Mini App URL تنظیم می‌کنیم.

## ۲. D1

از پوشه `apps/api`:

```bash
npx wrangler login
npx wrangler d1 create bluetap
```

`database_id` خروجی را در `wrangler.toml` جایگزین کن و سپس:

```bash
npm run db:migrate:remote
```

## ۳. Secretهای Worker

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

`BOT_USERNAME` در `wrangler.toml` روی `bluecoinxbot` تنظیم شده است. در Production مقدار `ALLOW_DEV_AUTH` باید `false` بماند.

سپس:

```bash
npm run deploy
```

## ۴. Frontend

فایل `apps/web/.env` بساز:

```env
VITE_API_BASE_URL=https://YOUR-WORKER.workers.dev
VITE_TONCONNECT_MANIFEST_URL=https://YOUR-MINIAPP-DOMAIN/tonconnect-manifest.json
```

در `public/tonconnect-manifest.json` دامنه واقعی Mini App را جایگزین `replace-with-your-production-domain.example` کن.

سپس:

```bash
npm run build -w @bluetap/web
```

خروجی `apps/web/dist` را روی Cloudflare Pages یا هر هاست HTTPS استاتیک منتشر کن.

## ۵. تست محلی

برای API فایل `.dev.vars` را از `.dev.vars.example` بساز. `ALLOW_DEV_AUTH=true` فقط برای Local Development است.

در Frontend نیز `VITE_DEV_TELEGRAM_ID` باعث فعال شدن حساب تست می‌شود.

## قبل از Claim واقعی BLUEX

- TON Proof برای اثبات مالکیت کیف پول
- سقف کل Season و فرمول تبدیل Points -> BLUEX
- خزانه جداگانه و ترجیحاً Multisig
- محدودیت برداشت، صف بررسی و Idempotency
- ضد Sybil/Referral abuse
- Audit لاگ و تست بار

تا انجام این موارد endpoint برداشت عمداً HTTP 423 برمی‌گرداند.
