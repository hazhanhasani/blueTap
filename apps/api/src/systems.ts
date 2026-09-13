import {
  CHALLENGES,
  JACKPOT_CONTRIBUTION_PERCENT,
  JACKPOT_INTERVAL_MS,
  leagueForPoints,
  previousWeekRange,
  randomIndex,
  utcDayKey,
  utcWeekKey,
  weekStartMs,
} from './features';
import type { Env, UserRow } from './types';

function publicPlayerId(id: number) {
  return `p${Math.max(0, Math.floor(id)).toString(36)}`;
}

export async function normalizeActivityCounters(env: Env, user: UserRow, now = Date.now()) {
  const day = utcDayKey(now);
  const week = utcWeekKey(now);
  let changed = false;
  if (user.daily_metric_day !== day) {
    await env.DB.prepare(`
      UPDATE users
      SET daily_metric_day = ?, daily_taps = 0, daily_auto_confirms = 0, daily_turbo_uses = 0
      WHERE id = ?
    `).bind(day, user.id).run();
    changed = true;
  }
  if (user.weekly_metric_week !== week) {
    await env.DB.prepare(`
      UPDATE users
      SET weekly_metric_week = ?, weekly_taps = 0, weekly_auto_confirms = 0, weekly_turbo_uses = 0
      WHERE id = ?
    `).bind(week, user.id).run();
    changed = true;
  }
  if (!changed) return user;
  return (await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<UserRow>())!;
}

function metricProgress(user: UserRow, metric: string) {
  if (metric === 'daily_taps') return Number(user.daily_taps || 0);
  if (metric === 'daily_auto_confirms') return Number(user.daily_auto_confirms || 0);
  if (metric === 'daily_turbo_uses') return Number(user.daily_turbo_uses || 0);
  if (metric === 'weekly_taps') return Number(user.weekly_taps || 0);
  if (metric === 'weekly_auto_confirms') return Number(user.weekly_auto_confirms || 0);
  if (metric === 'weekly_turbo_uses') return Number(user.weekly_turbo_uses || 0);
  return 0;
}

export async function challengeView(env: Env, user: UserRow, now = Date.now()) {
  const normalized = await normalizeActivityCounters(env, user, now);
  const day = utcDayKey(now);
  const week = utcWeekKey(now);
  const claims = await env.DB.prepare(`
    SELECT challenge_id, period_key
    FROM challenge_claims
    WHERE user_id = ? AND (period_key = ? OR period_key = ?)
  `).bind(normalized.id, day, week).all<{ challenge_id: string; period_key: string }>();
  const claimed = new Set((claims.results || []).map((row) => `${row.challenge_id}:${row.period_key}`));
  return CHALLENGES.map((challenge) => {
    const progress = metricProgress(normalized, challenge.metric);
    const periodKey = challenge.period === 'daily' ? day : week;
    return {
      ...challenge,
      periodKey,
      progress: Math.min(progress, challenge.target),
      completed: progress >= challenge.target,
      claimed: claimed.has(`${challenge.id}:${periodKey}`),
    };
  });
}

export async function claimChallenge(env: Env, user: UserRow, challengeId: string, now = Date.now()) {
  const challenge = CHALLENGES.find((item) => item.id === challengeId);
  if (!challenge) return { error: 'Challenge not found', status: 404 as const };
  const normalized = await normalizeActivityCounters(env, user, now);
  const progress = metricProgress(normalized, challenge.metric);
  if (progress < challenge.target) return { error: 'Challenge is not completed yet', status: 400 as const };
  const periodKey = challenge.period === 'daily' ? utcDayKey(now) : utcWeekKey(now);
  const inserted = await env.DB.prepare(`
    INSERT OR IGNORE INTO challenge_claims (user_id, challenge_id, period_key, reward, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(normalized.id, challenge.id, periodKey, challenge.reward, now).run();
  if (!inserted.meta.changes) return { error: 'Challenge already claimed', status: 409 as const };
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET points = points + ?, total_earned = total_earned + ?, updated_at = ? WHERE id = ?')
      .bind(challenge.reward, challenge.reward, now, normalized.id),
    env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(normalized.id, challenge.reward, 'challenge', JSON.stringify({ challengeId, periodKey }), now),
  ]);
  const fresh = (await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(normalized.id).first<UserRow>())!;
  return { reward: challenge.reward, user: fresh };
}

async function positiveLedgerSum(env: Env, userId: number, start: number, end: number) {
  const row = await env.DB.prepare(`
    SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS total
    FROM point_ledger
    WHERE user_id = ? AND created_at >= ? AND created_at < ?
  `).bind(userId, start, end).first<{ total: number }>();
  return Number(row?.total || 0);
}

export async function leagueView(env: Env, user: UserRow, now = Date.now()) {
  const currentStart = weekStartMs(now);
  const currentPoints = await positiveLedgerSum(env, user.id, currentStart, now + 1);
  const current = leagueForPoints(currentPoints);
  const previousRange = previousWeekRange(now);
  const previousPoints = await positiveLedgerSum(env, user.id, previousRange.start, previousRange.end);
  const previous = leagueForPoints(previousPoints);
  const claimed = await env.DB.prepare('SELECT 1 AS ok FROM league_reward_claims WHERE user_id = ? AND week_key = ?')
    .bind(user.id, previousRange.key).first<{ ok: number }>();
  return {
    current: { id: current.id, name: current.name, points: currentPoints, nextMin: current.nextMin, nextName: current.nextName },
    previous: {
      weekKey: previousRange.key,
      id: previous.id,
      name: previous.name,
      points: previousPoints,
      reward: previousPoints > 0 ? previous.reward : 0,
      claimable: previousPoints > 0 && !claimed,
      claimed: Boolean(claimed),
    },
  };
}

export async function claimPreviousLeagueReward(env: Env, user: UserRow, now = Date.now()) {
  const state = await leagueView(env, user, now);
  if (!state.previous.claimable || state.previous.reward <= 0) {
    return { error: state.previous.claimed ? 'League reward already claimed' : 'No league reward is available', status: 409 as const };
  }
  const inserted = await env.DB.prepare(`
    INSERT OR IGNORE INTO league_reward_claims (user_id, week_key, league_id, reward, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(user.id, state.previous.weekKey, state.previous.id, state.previous.reward, now).run();
  if (!inserted.meta.changes) return { error: 'League reward already claimed', status: 409 as const };
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET points = points + ?, total_earned = total_earned + ?, updated_at = ? WHERE id = ?')
      .bind(state.previous.reward, state.previous.reward, now, user.id),
    env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, state.previous.reward, 'league_reward', JSON.stringify({ weekKey: state.previous.weekKey, league: state.previous.id }), now),
  ]);
  const fresh = (await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<UserRow>())!;
  return { reward: state.previous.reward, user: fresh };
}

export async function contributeJackpot(env: Env, spent: number) {
  const contribution = Math.max(0, Math.floor(Number(spent || 0) * JACKPOT_CONTRIBUTION_PERCENT / 100));
  if (contribution <= 0) return 0;
  await env.DB.prepare(`
    INSERT INTO game_state (key, value) VALUES ('jackpot_pool', ?)
    ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + ?
  `).bind(String(contribution), contribution).run();
  return contribution;
}

async function stateValue(env: Env, key: string) {
  const row = await env.DB.prepare('SELECT value FROM game_state WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function maybeDrawJackpot(env: Env, now = Date.now()) {
  const cycle = String(Math.floor(now / JACKPOT_INTERVAL_MS));
  const previousCycle = await stateValue(env, 'jackpot_cycle');
  if (previousCycle === null) {
    await env.DB.prepare("INSERT OR IGNORE INTO game_state (key, value) VALUES ('jackpot_cycle', ?)").bind(cycle).run();
    return null;
  }
  if (previousCycle === cycle) return null;
  const lock = await env.DB.prepare("UPDATE game_state SET value = ? WHERE key = 'jackpot_cycle' AND value = ?")
    .bind(cycle, previousCycle).run();
  if (!lock.meta.changes) return null;
  const pool = Number((await stateValue(env, 'jackpot_pool')) || 0);
  if (pool <= 0) return null;
  const activeSince = now - JACKPOT_INTERVAL_MS;
  const countRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM users WHERE updated_at >= ?')
    .bind(activeSince).first<{ count: number }>();
  const activeCount = Number(countRow?.count || 0);
  if (activeCount <= 0) return null;
  const offset = randomIndex(activeCount);
  const winner = await env.DB.prepare('SELECT id, first_name, username FROM users WHERE updated_at >= ? ORDER BY id ASC LIMIT 1 OFFSET ?')
    .bind(activeSince, offset).first<{ id: number; first_name: string; username: string | null }>();
  if (!winner) return null;
  await env.DB.batch([
    env.DB.prepare("UPDATE game_state SET value = '0' WHERE key = 'jackpot_pool'"),
    env.DB.prepare(`
      INSERT INTO game_state (key, value) VALUES ('jackpot_last_winner', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).bind(JSON.stringify({ name: winner.username ? `@${winner.username}` : winner.first_name, amount: pool, at: now })),
    env.DB.prepare('UPDATE users SET points = points + ?, total_earned = total_earned + ?, updated_at = ? WHERE id = ?')
      .bind(pool, pool, now, winner.id),
    env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(winner.id, pool, 'jackpot_win', JSON.stringify({ cycle }), now),
  ]);
  return { winner: { public_id: publicPlayerId(winner.id), name: winner.username ? `@${winner.username}` : winner.first_name }, amount: pool };
}

export async function jackpotView(env: Env, now = Date.now()) {
  const pool = Number((await stateValue(env, 'jackpot_pool')) || 0);
  const lastRaw = await stateValue(env, 'jackpot_last_winner');
  let lastWinner: { name: string; amount: number; at: number } | null = null;
  if (lastRaw) {
    try {
      const parsed = JSON.parse(lastRaw) as { name?: unknown; amount?: unknown; at?: unknown };
      if (typeof parsed.name === 'string') {
        lastWinner = { name: parsed.name, amount: Number(parsed.amount || 0), at: Number(parsed.at || 0) };
      }
    } catch { lastWinner = null; }
  }
  const cycle = Math.floor(now / JACKPOT_INTERVAL_MS);
  return { pool, nextDrawAt: (cycle + 1) * JACKPOT_INTERVAL_MS, lastWinner, contributionPercent: JACKPOT_CONTRIBUTION_PERCENT };
}

export async function weeklyLeaderboard(env: Env, now = Date.now(), limit = 10) {
  const start = weekStartMs(now);
  const result = await env.DB.prepare(`
    SELECT u.id, u.username, u.first_name,
      COALESCE(SUM(CASE WHEN p.amount > 0 THEN p.amount ELSE 0 END), 0) AS points
    FROM users u
    LEFT JOIN point_ledger p ON p.user_id = u.id AND p.created_at >= ?
    GROUP BY u.id
    ORDER BY points DESC, u.id ASC
    LIMIT ?
  `).bind(start, Math.min(Math.max(limit, 1), 100)).all<{ id: number; username: string | null; first_name: string; points: number }>();
  return (result.results || []).map((row) => ({
    public_id: publicPlayerId(row.id),
    username: row.username,
    first_name: row.first_name,
    points: Number(row.points || 0),
  }));
}
