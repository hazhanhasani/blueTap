import type { UserRow } from './types';

export const ENERGY_REGEN_PER_SECOND = 1;
export const TAP_BUCKET_CAPACITY = 20;
export const TAP_BUCKET_REFILL_PER_SECOND = 8;
export const MAX_TAPS_PER_REQUEST = 20;
export const DAILY_REWARD = 500;

export const LEVELS = [
  { level: 1, name: 'Starter', min: 0 },
  { level: 2, name: 'Explorer', min: 5_000 },
  { level: 3, name: 'Wave', min: 25_000 },
  { level: 4, name: 'Captain', min: 100_000 },
  { level: 5, name: 'Legend', min: 500_000 },
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
    nextLevelPoints: next?.min ?? null,
  };
}

export function effectiveEnergy(user: UserRow, now: number) {
  const elapsed = Math.max(0, now - user.last_energy_at) / 1000;
  const recovered = Math.floor(elapsed * ENERGY_REGEN_PER_SECOND);
  return Math.min(user.max_energy, user.energy + recovered);
}

export function effectiveTapBucket(user: UserRow, now: number) {
  const elapsed = Math.max(0, now - user.tap_bucket_at) / 1000;
  return Math.min(TAP_BUCKET_CAPACITY, user.tap_bucket + elapsed * TAP_BUCKET_REFILL_PER_SECOND);
}

export function utcDay(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}
