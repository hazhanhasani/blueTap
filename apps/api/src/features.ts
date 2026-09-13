export const COMBO_WINDOW_MS = 2_500;
export const CHEST_COOLDOWN_MS = 15 * 60 * 1000;
export const AUTO_MINE_BOOST_MULTIPLIER = 2;
export const AUTO_MINE_BOOST_DURATION_MS = 30 * 60 * 1000;
export const AUTO_MINE_BOOST_COST = 7_500;
export const MINING_SHIELD_COST = 10_000;
export const MAX_MINING_SHIELDS = 5;
export const PRESTIGE_STEP = 500_000;
export const PRESTIGE_BONUS_PERCENT = 5;
export const JACKPOT_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const JACKPOT_CONTRIBUTION_PERCENT = 5;

export const SKINS = [
  { id: 'blue', name: 'آبی کلاسیک', cost: 0, icon: '🔵' },
  { id: 'neon', name: 'نئون', cost: 15_000, icon: '🟣' },
  { id: 'gold', name: 'طلایی', cost: 30_000, icon: '🟡' },
  { id: 'cyber', name: 'سایبری', cost: 50_000, icon: '💠' },
] as const;

export const CHALLENGES = [
  { id: 'daily_taps_200', title: 'امروز ۲۰۰ بار ضربه بزن', period: 'daily', metric: 'daily_taps', target: 200, reward: 1_000 },
  { id: 'daily_taps_600', title: 'امروز ۶۰۰ بار ضربه بزن', period: 'daily', metric: 'daily_taps', target: 600, reward: 1_500 },
  { id: 'daily_turbo_1', title: 'امروز یک بار توربو را فعال کن', period: 'daily', metric: 'daily_turbo_uses', target: 1, reward: 1_200 },
  { id: 'weekly_taps_3000', title: 'این هفته ۳٬۰۰۰ بار ضربه بزن', period: 'weekly', metric: 'weekly_taps', target: 3_000, reward: 10_000 },
  { id: 'weekly_taps_6000', title: 'این هفته ۶٬۰۰۰ بار ضربه بزن', period: 'weekly', metric: 'weekly_taps', target: 6_000, reward: 8_000 },
  { id: 'weekly_turbo_5', title: 'این هفته ۵ بار توربو را فعال کن', period: 'weekly', metric: 'weekly_turbo_uses', target: 5, reward: 10_000 },
] as const;

export const LEAGUES = [
  { id: 'bronze', name: 'برنزی', min: 0, reward: 500 },
  { id: 'silver', name: 'نقره‌ای', min: 10_000, reward: 1_500 },
  { id: 'gold', name: 'طلایی', min: 50_000, reward: 4_000 },
  { id: 'diamond', name: 'الماس', min: 150_000, reward: 10_000 },
  { id: 'master', name: 'استاد', min: 500_000, reward: 25_000 },
] as const;

export function comboMultiplierForCount(count: number) {
  if (count >= 100) return 3;
  if (count >= 30) return 2;
  return 1;
}

export function prestigeMultiplier(level: number) {
  return 1 + Math.max(0, Math.floor(level || 0)) * (PRESTIGE_BONUS_PERCENT / 100);
}

function randomFloat() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 0x1_0000_0000;
}

export function randomIndex(length: number) {
  if (length <= 1) return 0;
  return Math.min(length - 1, Math.floor(randomFloat() * length));
}

export function rollLuckyMultiplier() {
  const roll = randomFloat();
  if (roll < 0.0005) return 50;
  if (roll < 0.003) return 10;
  if (roll < 0.02) return 5;
  return 1;
}

export type ChestReward =
  | { type: 'points'; amount: number; label: string }
  | { type: 'energy'; amount: number; label: string }
  | { type: 'shield'; amount: number; label: string }
  | { type: 'auto_boost'; durationMs: number; label: string }
  | { type: 'turbo'; durationMs: number; label: string };

export function rollChestReward(maxEnergy: number): ChestReward {
  const roll = randomFloat();
  if (roll < 0.38) return { type: 'points', amount: 500, label: '+۵۰۰ امتیاز' };
  if (roll < 0.60) return { type: 'energy', amount: Math.max(250, Math.floor(maxEnergy * 0.25)), label: 'شارژ انرژی' };
  if (roll < 0.74) return { type: 'auto_boost', durationMs: 10 * 60 * 1000, label: 'ماین خودکار ×۲ برای ۱۰ دقیقه' };
  if (roll < 0.86) return { type: 'shield', amount: 1, label: '+۱ محافظ ماین' };
  if (roll < 0.97) return { type: 'points', amount: 2_000, label: '+۲٬۰۰۰ امتیاز' };
  return { type: 'turbo', durationMs: 60 * 1000, label: 'توربو رایگان برای ۶۰ ثانیه' };
}

export function utcDayKey(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function utcWeekKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const day = date.getUTCDay();
  const diff = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diff);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

export function weekStartMs(timestamp = Date.now()) {
  return Date.parse(`${utcWeekKey(timestamp)}T00:00:00.000Z`);
}

export function previousWeekRange(timestamp = Date.now()) {
  const currentStart = weekStartMs(timestamp);
  return { start: currentStart - 7 * 24 * 60 * 60 * 1000, end: currentStart, key: utcWeekKey(currentStart - 1) };
}

export function leagueForPoints(points: number) {
  let current: (typeof LEAGUES)[number] = LEAGUES[0];
  for (const league of LEAGUES) if (points >= league.min) current = league;
  const next = LEAGUES.find((league) => league.min > points) || null;
  return { ...current, nextMin: next?.min ?? null, nextName: next?.name ?? null };
}

export function blueHourState(now = Date.now()) {
  const date = new Date(now);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 18, 0, 0, 0);
  const end = start + 15 * 60 * 1000;
  const active = now >= start && now < end;
  const nextStartsAt = now < start ? start : start + 24 * 60 * 60 * 1000;
  return {
    active,
    name: 'ساعت آبی',
    tapMultiplier: active ? 2 : 1,
    endsAt: active ? end : null,
    nextStartsAt,
  };
}

export function chestState(lastChestAt: number, now = Date.now()) {
  const nextAt = Math.max(0, Number(lastChestAt || 0)) + CHEST_COOLDOWN_MS;
  const ready = !lastChestAt || now >= nextAt;
  return {
    ready,
    nextAt: ready ? now : nextAt,
    remainingSeconds: ready ? 0 : Math.ceil((nextAt - now) / 1000),
  };
}

export function nextDailyReward(streak: number) {
  const nextStreak = Math.max(0, Math.floor(streak || 0)) + 1;
  const day = ((nextStreak - 1) % 7) + 1;
  return 500 + (day - 1) * 100 + (day === 7 ? 1_000 : 0);
}

export function dailyRewardForStreak(streak: number) {
  const day = ((Math.max(1, Math.floor(streak || 1)) - 1) % 7) + 1;
  return { day, reward: 500 + (day - 1) * 100 + (day === 7 ? 1_000 : 0) };
}

export function isYesterday(lastDay: string | null, currentDay: string) {
  if (!lastDay) return false;
  const last = Date.parse(`${lastDay}T00:00:00.000Z`);
  const current = Date.parse(`${currentDay}T00:00:00.000Z`);
  return Number.isFinite(last) && Number.isFinite(current) && current - last === 24 * 60 * 60 * 1000;
}
