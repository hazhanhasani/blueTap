import type { UserRow } from './types';

export const TAP_BUCKET_CAPACITY = 20;
export const TAP_BUCKET_REFILL_PER_SECOND = 8;
export const MAX_TAPS_PER_REQUEST = 20;
export const DAILY_REWARD = 500;

export const MAX_TAP_POWER = 10;
export const TAP_POWER_BASE_COST = 2_500;
export const TURBO_MULTIPLIER = 3;
export const TURBO_DURATION_SECONDS = 30;
export const TURBO_BASE_COST = 5_000;

export const MAX_AUTO_MINE_LEVEL = 10;
export const AUTO_MINE_BASE_RATE_PER_MINUTE = 8;
export const AUTO_MINE_BASE_COST = 5_000;
export const AUTO_MINE_CONFIRM_WINDOW_SECONDS = 5 * 60 * 60;

export const LEVELS = [
  { level: 1, name: 'Starter', min: 0, maxEnergy: 1_000, energyRegenPerSecond: 1 },
  { level: 2, name: 'Explorer', min: 5_000, maxEnergy: 1_250, energyRegenPerSecond: 1 },
  { level: 3, name: 'Wave', min: 25_000, maxEnergy: 1_600, energyRegenPerSecond: 2 },
  { level: 4, name: 'Captain', min: 100_000, maxEnergy: 2_200, energyRegenPerSecond: 2 },
  { level: 5, name: 'Legend', min: 500_000, maxEnergy: 3_000, energyRegenPerSecond: 3 },
];

export const TASKS = [
  { id: 'taps_50', title: '۵۰ بار ضربه بزن', reward: 250, target: 50, metric: 'taps' },
  { id: 'wallet', title: 'کیف پول TON را متصل کن', reward: 500, target: 1, metric: 'wallet' },
  { id: 'referral_1', title: 'یک دوست دعوت کن', reward: 1_000, target: 1, metric: 'referrals' },
  { id: 'points_5000', title: 'به ۵٬۰۰۰ امتیاز برس', reward: 2_500, target: 5_000, metric: 'points' },
] as const;

export function getLevel(points: number) {
  let current = LEVELS[0];
  for (const level of LEVELS) if (points >= level.min) current = level;
  const next = LEVELS.find((level) => level.min > points);
  return {
    level: current.level,
    name: current.name,
    maxEnergy: current.maxEnergy,
    energyRegenPerSecond: current.energyRegenPerSecond,
    nextLevelPoints: next?.min ?? null,
    nextMaxEnergy: next?.maxEnergy ?? null,
    nextEnergyRegenPerSecond: next?.energyRegenPerSecond ?? null,
  };
}

export function tapPowerLevel(user: UserRow) {
  return Math.min(MAX_TAP_POWER, Math.max(1, Number(user.tap_power_level || 1)));
}

export function tapPowerUpgradeCost(currentLevel: number) {
  const level = Math.min(MAX_TAP_POWER, Math.max(1, Math.floor(currentLevel || 1)));
  if (level >= MAX_TAP_POWER) return null;
  return TAP_POWER_BASE_COST * level * level;
}

export function turboCost(user: UserRow) {
  return TURBO_BASE_COST + (tapPowerLevel(user) - 1) * 1_500;
}

export function isTurboActive(user: UserRow, now = Date.now()) {
  return Number(user.turbo_until || 0) > now;
}

export function tapRewardPerTap(user: UserRow, now = Date.now()) {
  const power = tapPowerLevel(user);
  return power * (isTurboActive(user, now) ? TURBO_MULTIPLIER : 1);
}

export function autoMineLevel(user: UserRow) {
  return Math.min(MAX_AUTO_MINE_LEVEL, Math.max(1, Number(user.auto_mine_level || 1)));
}

export function autoMineRatePerMinute(userOrLevel: UserRow | number) {
  const level = typeof userOrLevel === 'number'
    ? Math.min(MAX_AUTO_MINE_LEVEL, Math.max(1, Math.floor(userOrLevel || 1)))
    : autoMineLevel(userOrLevel);
  return level * AUTO_MINE_BASE_RATE_PER_MINUTE;
}

export function autoMineUpgradeCost(currentLevel: number) {
  const level = Math.min(MAX_AUTO_MINE_LEVEL, Math.max(1, Math.floor(currentLevel || 1)));
  if (level >= MAX_AUTO_MINE_LEVEL) return null;
  return AUTO_MINE_BASE_COST * level * level;
}

export function autoMineState(user: UserRow, now = Date.now()) {
  const level = autoMineLevel(user);
  const ratePerMinute = autoMineRatePerMinute(level);
  const fallback = Number(user.updated_at || user.created_at || now);
  const lastAt = Number(user.auto_mine_last_at || fallback);
  const confirmedAt = Number(user.auto_mine_confirmed_at || fallback);
  const deadlineAt = confirmedAt + AUTO_MINE_CONFIRM_WINDOW_SECONDS * 1000;
  const accrualEnd = Math.min(now, deadlineAt);
  const accrualStart = Math.min(lastAt, accrualEnd);
  const elapsedMs = Math.max(0, accrualEnd - accrualStart);
  const pending = Math.floor((elapsedMs * ratePerMinute) / 60_000);
  const expired = now >= deadlineAt;

  return {
    level,
    ratePerMinute,
    lastAt,
    confirmedAt,
    deadlineAt,
    pending,
    expired,
    remainingSeconds: expired ? 0 : Math.max(0, Math.ceil((deadlineAt - now) / 1000)),
    burnedTotal: Number(user.auto_mine_burned || 0),
  };
}

export function energyProgression(user: UserRow) {
  return getLevel(Number(user.total_earned || 0));
}

export function effectiveEnergy(user: UserRow, now: number) {
  const progression = energyProgression(user);
  const elapsed = Math.max(0, now - user.last_energy_at) / 1000;
  const recovered = Math.floor(elapsed * progression.energyRegenPerSecond);
  return Math.min(progression.maxEnergy, Number(user.energy || 0) + recovered);
}

export function effectiveTapBucket(user: UserRow, now: number) {
  const elapsed = Math.max(0, now - user.tap_bucket_at) / 1000;
  return Math.min(TAP_BUCKET_CAPACITY, user.tap_bucket + elapsed * TAP_BUCKET_REFILL_PER_SECOND);
}

export function utcDay(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}
