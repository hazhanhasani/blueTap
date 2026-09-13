import {
  AUTO_MINE_BOOST_COST,
  AUTO_MINE_BOOST_DURATION_MS,
  AUTO_MINE_BOOST_MULTIPLIER,
  blueHourState,
  chestState,
  COMBO_WINDOW_MS,
  comboMultiplierForCount,
  MAX_MINING_SHIELDS,
  MINING_SHIELD_COST,
  nextDailyReward,
  PRESTIGE_BONUS_PERCENT,
  PRESTIGE_STEP,
} from './features';
import {
  AUTO_MINE_CONFIRM_WINDOW_SECONDS,
  autoMineState,
  autoMineUpgradeCost,
  effectiveEnergy,
  getLevel,
  isTurboActive,
  MAX_AUTO_MINE_LEVEL,
  MAX_TAP_POWER,
  TASKS,
  tapPowerLevel,
  tapPowerUpgradeCost,
  TURBO_DURATION_SECONDS,
  TURBO_MULTIPLIER,
  turboCost,
  utcDay,
} from './game';
import { normalizeActivityCounters } from './systems';
import type { Env, TelegramAuth, UserRow } from './types';

function referralCode(telegramId: string) {
  try {
    return `bt${BigInt(telegramId).toString(36)}`;
  } catch {
    return `bt${telegramId.replace(/\D/g, '').slice(-12)}`;
  }
}

function parseUnlockedSkins(raw: string) {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) return Array.from(new Set(['blue', ...parsed.map(String)]));
  } catch {}
  return ['blue'];
}

export async function getUserByTelegramId(env: Env, telegramId: string) {
  return env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(telegramId).first<UserRow>();
}

export async function ensureUser(env: Env, auth: TelegramAuth) {
  const existing = await getUserByTelegramId(env, auth.id);
  if (existing) {
    const now = Date.now();
    const inviteCode = auth.startParam?.startsWith('ref_') ? auth.startParam.slice(4) : '';
    const accountAge = now - Number(existing.created_at || 0);
    if (!existing.referred_by && inviteCode && accountAge >= 0 && accountAge <= 24 * 60 * 60 * 1000) {
      await applyReferral(env, existing, inviteCode);
    }
    await env.DB.prepare('UPDATE users SET username = ?, first_name = ?, updated_at = ? WHERE id = ?')
      .bind(auth.username || null, auth.firstName, now, existing.id)
      .run();
    const fresh = (await getUserByTelegramId(env, auth.id))!;
    return { user: await normalizeActivityCounters(env, fresh), created: false };
  }

  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO users (
      telegram_id, username, first_name, referral_code,
      last_energy_at, tap_bucket_at, auto_mine_last_at, auto_mine_confirmed_at,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(auth.id, auth.username || null, auth.firstName, referralCode(auth.id), now, now, now, now, now, now).run();

  let user = (await getUserByTelegramId(env, auth.id))!;
  user = await normalizeActivityCounters(env, user, now);
  if (auth.startParam?.startsWith('ref_')) await applyReferral(env, user, auth.startParam.slice(4));
  return { user: (await getUserByTelegramId(env, auth.id))!, created: true };
}

async function applyReferral(env: Env, user: UserRow, code: string) {
  if (user.referred_by || !/^bt[a-z0-9]+$/i.test(code)) return;
  const inviter = await env.DB.prepare('SELECT * FROM users WHERE referral_code = ?').bind(code).first<UserRow>();
  if (!inviter || inviter.id === user.id) return;
  const now = Date.now();
  const linked = await env.DB.prepare(`
    UPDATE users
    SET referred_by = ?, points = points + 100, total_earned = total_earned + 100, updated_at = ?
    WHERE id = ? AND referred_by IS NULL
  `).bind(inviter.id, now, user.id).run();
  if (!linked.meta.changes) return;
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET points = points + 500, total_earned = total_earned + 500, updated_at = ? WHERE id = ?').bind(now, inviter.id),
    env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, 100, ?, ?, ?)').bind(user.id, 'referral_join', JSON.stringify({ inviter: inviter.id }), now),
    env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, 500, ?, ?, ?)').bind(inviter.id, 'referral_invite', JSON.stringify({ referred: user.id }), now),
  ]);
}

export async function referralCount(env: Env, userId: number) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM users WHERE referred_by = ?').bind(userId).first<{ count: number }>();
  return Number(row?.count || 0);
}

export async function claimedTaskIds(env: Env, userId: number) {
  const result = await env.DB.prepare('SELECT task_id FROM task_claims WHERE user_id = ?').bind(userId).all<{ task_id: string }>();
  return new Set((result.results || []).map((row) => row.task_id));
}

export async function taskView(env: Env, user: UserRow) {
  const [refs, claimed] = await Promise.all([referralCount(env, user.id), claimedTaskIds(env, user.id)]);
  return TASKS.map((task) => {
    let progress = 0;
    if (task.metric === 'taps') progress = user.taps;
    if (task.metric === 'referrals') progress = refs;
    if (task.metric === 'points') progress = user.total_earned;
    return { ...task, progress: Math.min(progress, task.target), completed: progress >= task.target, claimed: claimed.has(task.id) };
  });
}

export async function profileView(env: Env, user: UserRow) {
  const now = Date.now();
  const normalized = await normalizeActivityCounters(env, user, now);
  const refs = await referralCount(env, normalized.id);
  const totalEarned = Number(normalized.total_earned || 0);
  const level = getLevel(totalEarned);
  const powerLevel = tapPowerLevel(normalized);
  const turboActive = isTurboActive(normalized, now);
  const autoMine = autoMineState(normalized, now);
  const comboActive = now - Number(normalized.combo_last_at || 0) <= COMBO_WINDOW_MS;
  const comboCount = comboActive ? Number(normalized.combo_count || 0) : 0;
  const prestigeLevel = Number(normalized.prestige_level || 0);
  const chest = chestState(Number(normalized.last_chest_at || 0), now);
  const event = blueHourState(now);
  const dailyStreak = Number(normalized.daily_streak || 0);
  const prestigeRequirement = PRESTIGE_STEP * (prestigeLevel + 1);

  return {
    id: normalized.telegram_id,
    firstName: normalized.first_name,
    username: normalized.username,
    points: normalized.points,
    updatedAt: Number(normalized.updated_at || 0),
    totalEarned,
    taps: normalized.taps,
    energy: effectiveEnergy(normalized, now),
    referralCode: normalized.referral_code,
    referrals: refs,
    walletAddress: normalized.wallet_address,
    canClaimDaily: normalized.last_daily_day !== utcDay(now),
    dailyStreak,
    dailyNextReward: nextDailyReward(dailyStreak),
    tapPower: powerLevel,
    tapPowerLevel: powerLevel,
    tapPowerUpgradeCost: tapPowerUpgradeCost(powerLevel),
    maxTapPower: MAX_TAP_POWER,
    turboActive,
    turboMultiplier: TURBO_MULTIPLIER,
    turboDurationSeconds: TURBO_DURATION_SECONDS,
    turboUntil: Number(normalized.turbo_until || 0),
    turboRemainingSeconds: turboActive ? Math.max(0, Math.ceil((Number(normalized.turbo_until) - now) / 1000)) : 0,
    turboCost: turboCost(normalized),
    autoMineLevel: autoMine.level,
    autoMineRatePerMinute: autoMine.ratePerMinute,
    autoMineBaseRatePerMinute: autoMine.baseRatePerMinute,
    autoMineUpgradeCost: autoMineUpgradeCost(autoMine.level),
    maxAutoMineLevel: MAX_AUTO_MINE_LEVEL,
    autoMineLastAt: autoMine.lastAt,
    autoMineConfirmedAt: autoMine.confirmedAt,
    autoMineDeadlineAt: autoMine.deadlineAt,
    autoMinePending: autoMine.pending,
    autoMineExpired: autoMine.expired,
    autoMineRemainingSeconds: autoMine.remainingSeconds,
    autoMineConfirmWindowSeconds: AUTO_MINE_CONFIRM_WINDOW_SECONDS,
    autoMineBurnedTotal: autoMine.burnedTotal,
    autoMineBoostActive: autoMine.boostActive,
    autoMineBoostUntil: autoMine.boostUntil,
    autoMineBoostRemainingSeconds: autoMine.boostRemainingSeconds,
    autoMineBoostMultiplier: AUTO_MINE_BOOST_MULTIPLIER,
    autoMineBoostCost: AUTO_MINE_BOOST_COST,
    autoMineBoostDurationSeconds: Math.floor(AUTO_MINE_BOOST_DURATION_MS / 1000),
    miningShields: Number(normalized.mining_shields || 0),
    miningShieldCost: MINING_SHIELD_COST,
    maxMiningShields: MAX_MINING_SHIELDS,
    prestigeLevel,
    prestigeBonusPercent: prestigeLevel * PRESTIGE_BONUS_PERCENT,
    prestigeRequirement,
    canPrestige: totalEarned >= prestigeRequirement,
    comboCount,
    comboMultiplier: comboMultiplierForCount(comboCount),
    comboExpiresAt: comboActive ? Number(normalized.combo_last_at) + COMBO_WINDOW_MS : 0,
    luckyHits: Number(normalized.lucky_hits || 0),
    chestReady: chest.ready,
    chestNextAt: chest.nextAt,
    chestRemainingSeconds: chest.remainingSeconds,
    selectedSkin: normalized.selected_skin || 'blue',
    unlockedSkins: parseUnlockedSkins(normalized.unlocked_skins),
    event,
    ...level,
  };
}

export async function leaderboard(env: Env, limit = 20) {
  const result = await env.DB.prepare('SELECT id, username, first_name, total_earned AS points FROM users ORDER BY total_earned DESC, id ASC LIMIT ?')
    .bind(Math.min(Math.max(limit, 1), 100))
    .all<{ id: number; username: string | null; first_name: string; points: number }>();
  return (result.results || []).map((row) => ({
    public_id: `p${Number(row.id).toString(36)}`,
    username: row.username,
    first_name: row.first_name,
    points: Number(row.points || 0),
  }));
}
