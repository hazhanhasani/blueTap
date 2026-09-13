export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  ALLOWED_ORIGIN?: string;
  ALLOW_DEV_AUTH?: string;
  AUTH_MAX_AGE_SECONDS?: string;
  BLUEX_JETTON_MASTER: string;
  BOT_USERNAME?: string;
}

export interface TelegramAuth {
  id: string;
  username?: string;
  firstName: string;
  startParam?: string;
}

export interface UserRow {
  id: number;
  telegram_id: string;
  username: string | null;
  first_name: string;
  points: number;
  taps: number;
  energy: number;
  max_energy: number;
  last_energy_at: number;
  tap_bucket: number;
  tap_bucket_at: number;
  referral_code: string;
  referred_by: number | null;
  wallet_address: string | null;
  last_daily_day: string | null;
  created_at: number;
  updated_at: number;
}
