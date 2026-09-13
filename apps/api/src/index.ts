import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authenticateRequest } from './telegram';
import { handleTelegramUpdate } from './bot';
import {
  autoMineLevel,
  autoMineState,
  autoMineUpgradeCost,
  DAILY_REWARD,
  effectiveEnergy,
  effectiveTapBucket,
  isTurboActive,
  MAX_TAPS_PER_REQUEST,
  TASKS,
  tapPowerLevel,
  tapPowerUpgradeCost,
  tapRewardPerTap,
  TURBO_DURATION_SECONDS,
  turboCost,
  utcDay,
} from './game';
import { ensureUser, getUserByTelegramId, leaderboard, profileView, taskView } from './db';
import type { Env, TelegramAuth, UserRow } from './types';

type Variables = { auth: TelegramAuth };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type', 'X-Dev-Telegram-Id', 'X-Dev-First-Name'] }));

app.get('/health', (c) => c.json({
  ok: true,
  service: 'BlueTap API',
  telegramBotConfigured: Boolean(c.env.TELEGRAM_BOT_TOKEN),
  telegramWebhookSecretConfigured: Boolean(c.env.TELEGRAM_WEBHOOK_SECRET),
}));

app.post('/telegram/webhook', async (c) => {
  const expectedSecret = c.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) return c.json({ error: 'Telegram webhook secret is not configured' }, 503);

  const receivedSecret = c.req.header('X-Telegram-Bot-Api-Secret-Token') || '';
  if (receivedSecret !== expectedSecret) return c.json({ error: 'Invalid webhook secret' }, 401);

  const update = await c.req.json().catch(() => null);
  if (!update) return c.json({ ok: true });

  const appUrl = new URL(c.req.url).origin;
  await handleTelegramUpdate(update, c.env, appUrl);
  return c.json({ ok: true });
});

app.use('/api/*', async (c, next) => {
  try {
    c.set('auth', await authenticateRequest(c.req.raw, c.env));
    await next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    return c.json({ error: message }, 401);
  }
});

async function currentUser(c: any): Promise<UserRow> {
  const auth = c.get('auth') as TelegramAuth;
  const { user } = await ensureUser(c.env as Env, auth);
  return user;
}

async function settleAutoMine(env: Env, user: UserRow, now = Date.now()) {
  const state = autoMineState(user, now);
  const expectedLastAt = Number(user.auto_mine_last_at || 0);
  const expectedConfirmedAt = Number(user.auto_mine_confirmed_at || 0);

  if (state.expired) {
    const result = await env.DB.prepare(`
      UPDATE users
      SET auto_mine_burned = auto_mine_burned + ?, auto_mine_last_at = ?, auto_mine_confirmed_at = ?, updated_at = ?
      WHERE id = ? AND auto_mine_last_at = ? AND auto_mine_confirmed_at = ?
    `).bind(state.pending, now, now, now, user.id, expectedLastAt, expectedConfirmedAt).run();

    if (result.meta.changes && state.pending > 0) {
      await env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, 0, ?, ?, ?)')
        .bind(user.id, 'auto_mine_burn', JSON.stringify({ burned: state.pending, missedDeadlineAt: state.deadlineAt }), now)
        .run();
    }

    const fresh = (await getUserByTelegramId(env, user.telegram_id))!;
    return { awarded: 0, burned: result.meta.changes ? state.pending : 0, user: fresh };
  }

  const result = await env.DB.prepare(`
    UPDATE users
    SET points = points + ?, total_earned = total_earned + ?, auto_mine_last_at = ?, auto_mine_confirmed_at = ?, updated_at = ?
    WHERE id = ? AND auto_mine_last_at = ? AND auto_mine_confirmed_at = ?
  `).bind(state.pending, state.pending, now, now, now, user.id, expectedLastAt, expectedConfirmedAt).run();

  if (result.meta.changes && state.pending > 0) {
    await env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, state.pending, 'auto_mine', JSON.stringify({ ratePerMinute: state.ratePerMinute, level: state.level }), now)
      .run();
  }

  const fresh = (await getUserByTelegramId(env, user.telegram_id))!;
  return { awarded: result.meta.changes ? state.pending : 0, burned: 0, user: fresh };
}

app.get('/api/bootstrap', async (c) => {
  const user = await currentUser(c);
  const [profile, tasks, leaders] = await Promise.all([
    profileView(c.env, user),
    taskView(c.env, user),
    leaderboard(c.env, 10),
  ]);
  const inviteUrl = c.env.BOT_USERNAME ? `https://t.me/${c.env.BOT_USERNAME}?startapp=ref_${user.referral_code}` : null;
  return c.json({
    profile,
    tasks,
    leaderboard: leaders,
    inviteUrl,
    token: { symbol: 'BLUEX', jettonMaster: c.env.BLUEX_JETTON_MASTER },
    season: { name: 'Season 1', claimEnabled: false },
  });
});

app.post('/api/tap', async (c) => {
  const user = await currentUser(c);
  const body: { count?: number } = await c.req.json<{ count?: number }>().catch(() => ({ count: 1 }));
  const requested = Math.min(MAX_TAPS_PER_REQUEST, Math.max(1, Math.floor(Number(body.count || 1))));
  const now = Date.now();
  const energy = effectiveEnergy(user, now);
  const bucket = effectiveTapBucket(user, now);
  const tapValue = tapRewardPerTap(user, now);
  const affordableTaps = Math.floor(energy / tapValue);
  const awardedTaps = Math.max(0, Math.min(requested, Math.floor(bucket), affordableTaps));
  const awarded = awardedTaps * tapValue;
  const energySpent = awarded;
  const nextBucket = Math.max(0, bucket - awardedTaps);

  await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE users
      SET points = points + ?, total_earned = total_earned + ?, taps = taps + ?, energy = ?, last_energy_at = ?, tap_bucket = ?, tap_bucket_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(awarded, awarded, awardedTaps, energy - energySpent, now, nextBucket, now, now, user.id),
    c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, awarded, 'tap', JSON.stringify({ requested, awardedTaps, tapValue, energySpent, turbo: isTurboActive(user, now) }), now),
  ]);

  const fresh = (await getUserByTelegramId(c.env, user.telegram_id))!;
  return c.json({ awarded, awardedTaps, tapValue, energySpent, profile: await profileView(c.env, fresh) });
});

app.post('/api/auto-mine/confirm', async (c) => {
  const user = await currentUser(c);
  const result = await settleAutoMine(c.env, user);
  return c.json({
    awarded: result.awarded,
    burned: result.burned,
    profile: await profileView(c.env, result.user),
  });
});

app.post('/api/upgrades/auto-mine', async (c) => {
  const user = await currentUser(c);
  const now = Date.now();
  const settled = await settleAutoMine(c.env, user, now);
  const current = settled.user;
  const level = autoMineLevel(current);
  const cost = autoMineUpgradeCost(level);

  if (cost === null) return c.json({ error: 'Maximum auto-mine level reached' }, 409);
  if (current.points < cost) return c.json({ error: 'Blue Points کافی نیست' }, 409);

  const result = await c.env.DB.prepare(`
    UPDATE users
    SET points = points - ?, auto_mine_level = auto_mine_level + 1, auto_mine_last_at = ?, auto_mine_confirmed_at = ?, updated_at = ?
    WHERE id = ? AND points >= ? AND auto_mine_level = ?
  `).bind(cost, now, now, now, current.id, cost, level).run();

  if (!result.meta.changes) return c.json({ error: 'ارتقای ماین خودکار انجام نشد؛ دوباره تلاش کن' }, 409);
  await c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(current.id, -cost, 'upgrade_auto_mine', JSON.stringify({ from: level, to: level + 1 }), now)
    .run();

  const fresh = (await getUserByTelegramId(c.env, current.telegram_id))!;
  return c.json({
    cost,
    settledAwarded: settled.awarded,
    burned: settled.burned,
    profile: await profileView(c.env, fresh),
  });
});

app.post('/api/upgrades/tap-power', async (c) => {
  const user = await currentUser(c);
  const level = tapPowerLevel(user);
  const cost = tapPowerUpgradeCost(level);
  if (cost === null) return c.json({ error: 'Maximum tap power reached' }, 409);
  if (user.points < cost) return c.json({ error: 'Blue Points کافی نیست' }, 409);

  const now = Date.now();
  const result = await c.env.DB.prepare(`
    UPDATE users
    SET points = points - ?, tap_power_level = tap_power_level + 1, updated_at = ?
    WHERE id = ? AND points >= ? AND tap_power_level = ?
  `).bind(cost, now, user.id, cost, level).run();

  if (!result.meta.changes) return c.json({ error: 'ارتقا انجام نشد؛ دوباره تلاش کن' }, 409);
  await c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(user.id, -cost, 'upgrade_tap_power', JSON.stringify({ from: level, to: level + 1 }), now)
    .run();

  const fresh = (await getUserByTelegramId(c.env, user.telegram_id))!;
  return c.json({ cost, profile: await profileView(c.env, fresh) });
});

app.post('/api/upgrades/turbo', async (c) => {
  const user = await currentUser(c);
  const now = Date.now();
  if (isTurboActive(user, now)) return c.json({ error: 'توربو همین حالا فعال است' }, 409);

  const cost = turboCost(user);
  if (user.points < cost) return c.json({ error: 'Blue Points کافی نیست' }, 409);
  const turboUntil = now + TURBO_DURATION_SECONDS * 1000;

  const result = await c.env.DB.prepare(`
    UPDATE users
    SET points = points - ?, turbo_until = ?, updated_at = ?
    WHERE id = ? AND points >= ? AND turbo_until <= ?
  `).bind(cost, turboUntil, now, user.id, cost, now).run();

  if (!result.meta.changes) return c.json({ error: 'فعال‌سازی توربو انجام نشد؛ دوباره تلاش کن' }, 409);
  await c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(user.id, -cost, 'turbo', JSON.stringify({ durationSeconds: TURBO_DURATION_SECONDS, turboUntil }), now)
    .run();

  const fresh = (await getUserByTelegramId(c.env, user.telegram_id))!;
  return c.json({ cost, profile: await profileView(c.env, fresh) });
});

app.post('/api/daily', async (c) => {
  const user = await currentUser(c);
  const day = utcDay();
  if (user.last_daily_day === day) return c.json({ error: 'Daily reward already claimed' }, 409);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET points = points + ?, total_earned = total_earned + ?, last_daily_day = ?, updated_at = ? WHERE id = ?').bind(DAILY_REWARD, DAILY_REWARD, day, now, user.id),
    c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, created_at) VALUES (?, ?, ?, ?)').bind(user.id, DAILY_REWARD, 'daily', now),
  ]);
  const fresh = (await getUserByTelegramId(c.env, user.telegram_id))!;
  return c.json({ reward: DAILY_REWARD, profile: await profileView(c.env, fresh) });
});

app.post('/api/wallet', async (c) => {
  const user = await currentUser(c);
  const body: { address?: string } = await c.req.json<{ address?: string }>().catch(() => ({ address: '' }));
  const address = String(body.address || '').trim();
  const userFriendly = /^[A-Za-z0-9_-]{48}$/.test(address);
  const raw = /^-?\d+:[0-9a-fA-F]{64}$/.test(address);
  if (!userFriendly && !raw) return c.json({ error: 'Invalid TON address' }, 400);
  await c.env.DB.prepare('UPDATE users SET wallet_address = ?, updated_at = ? WHERE id = ?').bind(address, Date.now(), user.id).run();
  const fresh = (await getUserByTelegramId(c.env, user.telegram_id))!;
  return c.json({ profile: await profileView(c.env, fresh), proofRequiredForClaim: true });
});

app.post('/api/tasks/:taskId/claim', async (c) => {
  const user = await currentUser(c);
  const taskId = c.req.param('taskId');
  const task = TASKS.find((item) => item.id === taskId);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  const tasks = await taskView(c.env, user);
  const state = tasks.find((item) => item.id === taskId)!;
  if (state.claimed) return c.json({ error: 'Task already claimed' }, 409);
  if (!state.completed) return c.json({ error: 'Task is not completed yet' }, 400);

  const now = Date.now();
  const inserted = await c.env.DB.prepare('INSERT OR IGNORE INTO task_claims (user_id, task_id, reward, created_at) VALUES (?, ?, ?, ?)')
    .bind(user.id, task.id, task.reward, now)
    .run();
  if (!inserted.meta.changes) return c.json({ error: 'Task already claimed' }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET points = points + ?, total_earned = total_earned + ?, updated_at = ? WHERE id = ?').bind(task.reward, task.reward, now, user.id),
    c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, task.reward, 'task', JSON.stringify({ taskId }), now),
  ]);

  const fresh = (await getUserByTelegramId(c.env, user.telegram_id))!;
  return c.json({ reward: task.reward, profile: await profileView(c.env, fresh), tasks: await taskView(c.env, fresh) });
});

app.get('/api/leaderboard', async (c) => c.json({ leaderboard: await leaderboard(c.env, 100) }));

app.post('/api/claim', async (c) => {
  await currentUser(c);
  return c.json({ error: 'BLUEX claim is locked until Season 1 distribution and TON proof are finalized.' }, 423);
});

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
