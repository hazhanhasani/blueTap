import { effectiveEnergy, getLevel, TASKS, utcDay } from './game';
import type { Env, TelegramAuth, UserRow } from './types';

function referralCode(telegramId: string) {
  try {
    return `bt${BigInt(telegramId).toString(36)}`;
  } catch {
    return `bt${telegramId.replace(/\D/g, '').slice(-12)}`;
  }
}

export async function getUserByTelegramId(env: Env, telegramId: string) {
  return env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(telegramId).first<UserRow>();
}

export async function ensureUser(env: Env, auth: TelegramAuth) {
  const existing = await getUserByTelegramId(env, auth.id);
  if (existing) {
    await env.DB.prepare('UPDATE users SET username = ?, first_name = ?, updated_at = ? WHERE id = ?')
      .bind(auth.username || null, auth.firstName, Date.now(), existing.id)
      .run();
    return { user: (await getUserByTelegramId(env, auth.id))!, created: false };
  }

  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO users (telegram_id, username, first_name, referral_code, last_energy_at, tap_bucket_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(auth.id, auth.username || null, auth.firstName, referralCode(auth.id), now, now, now, now).run();

  const user = (await getUserByTelegramId(env, auth.id))!;
  if (auth.startParam?.startsWith('ref_')) await applyReferral(env, user, auth.startParam.slice(4));
  return { user: (await getUserByTelegramId(env, auth.id))!, created: true };
}

async function applyReferral(env: Env, user: UserRow, code: string) {
  if (user.referred_by) return;
  const inviter = await env.DB.prepare('SELECT * FROM users WHERE referral_code = ?').bind(code).first<UserRow>();
  if (!inviter || inviter.id === user.id) return;

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET referred_by = ?, points = points + 100, updated_at = ? WHERE id = ? AND referred_by IS NULL').bind(inviter.id, now, user.id),
    env.DB.prepare('UPDATE users SET points = points + 500, updated_at = ? WHERE id = ?').bind(now, inviter.id),
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
    if (task.metric === 'wallet') progress = user.wallet_address ? 1 : 0;
    if (task.metric === 'referrals') progress = refs;
    if (task.metric === 'points') progress = user.points;
    return { ...task, progress: Math.min(progress, task.target), completed: progress >= task.target, claimed: claimed.has(task.id) };
  });
}

export async function profileView(env: Env, user: UserRow) {
  const now = Date.now();
  const refs = await referralCount(env, user.id);
  const level = getLevel(user.points);
  return {
    id: user.telegram_id,
    firstName: user.first_name,
    username: user.username,
    points: user.points,
    taps: user.taps,
    energy: effectiveEnergy(user, now),
    maxEnergy: user.max_energy,
    referralCode: user.referral_code,
    referrals: refs,
    walletAddress: user.wallet_address,
    canClaimDaily: user.last_daily_day !== utcDay(now),
    ...level,
  };
}

export async function leaderboard(env: Env, limit = 20) {
  const result = await env.DB.prepare('SELECT telegram_id, username, first_name, points FROM users ORDER BY points DESC, id ASC LIMIT ?')
    .bind(Math.min(Math.max(limit, 1), 100))
    .all<{ telegram_id: string; username: string | null; first_name: string; points: number }>();
  return result.results || [];
}
