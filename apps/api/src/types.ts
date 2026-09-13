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
  total_earned: number;
  taps: number;
  energy: number;
  max_energy: number;
  last_energy_at: number;
  tap_bucket: number;
  tap_bucket_at: number;
  tap_power_level: number;
  turbo_until: number;
  auto_mine_level: number;
  auto_mine_last_at: number;
  auto_mine_confirmed_at: number;
  auto_mine_burned: number;
  auto_mine_boost_until: number;
  mining_shields: number;
  prestige_level: number;
  combo_count: number;
  combo_last_at: number;
  lucky_hits: number;
  daily_streak: number;
  last_chest_at: number;
  daily_metric_day: string;
  daily_taps: number;
  daily_auto_confirms: number;
  daily_turbo_uses: number;
  weekly_metric_week: string;
  weekly_taps: number;
  weekly_auto_confirms: number;
  weekly_turbo_uses: number;
  selected_skin: string;
  unlocked_skins: string;
  referral_code: string;
  referred_by: number | null;
  wallet_address: string | null;
  last_daily_day: string | null;
  created_at: number;
  updated_at: number;
}
