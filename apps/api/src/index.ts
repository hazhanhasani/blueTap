import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authenticateRequest } from './telegram';
import { DAILY_REWARD, effectiveEnergy, effectiveTapBucket, MAX_TAPS_PER_REQUEST, TASKS, utcDay } from './game';
import { ensureUser, getUserByTelegramId, leaderboard, profileView, taskView } from './db';
import type { Env, TelegramAuth, UserRow } from './types';

type Variables = { auth: TelegramAuth };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type', 'X-Dev-Telegram-Id', 'X-Dev-First-Name'] }));

app.get('/health', (c) => c.json({ ok: true, service: 'BlueTap API' }));

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
  const body = await c.req.json<{ count?: number }>().catch(() => ({}));
  const requested = Math.min(MAX_TAPS_PER_REQUEST, Math.max(1, Math.floor(Number(body.count || 1))));
  const now = Date.now();
  const energy = effectiveEnergy(user, now);
  const bucket = effectiveTapBucket(user, now);
  const awarded = Math.max(0, Math.min(requested, Math.floor(bucket), energy));
  const nextBucket = Math.max(0, bucket - awarded);

  await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE users
      SET points = points + ?, taps = taps + ?, energy = ?, last_energy_at = ?, tap_bucket = ?, tap_bucket_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(awarded, awarded, energy - awarded, now, nextBucket, now, now, user.id),
    c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, awarded, 'tap', JSON.stringify({ requested }), now),
  ]);

  const fresh = (await getUserByTelegramId(c.env, user.telegram_id))!;
  return c.json({ awarded, profile: await profileView(c.env, fresh) });
});

app.post('/api/daily', async (c) => {
  const user = await currentUser(c);
  const day = utcDay();
  if (user.last_daily_day === day) return c.json({ error: 'Daily reward already claimed' }, 409);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET points = points + ?, last_daily_day = ?, updated_at = ? WHERE id = ?').bind(DAILY_REWARD, day, now, user.id),
    c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, created_at) VALUES (?, ?, ?, ?)').bind(user.id, DAILY_REWARD, 'daily', now),
  ]);
  const fresh = (await getUserByTelegramId(c.env, user.telegram_id))!;
  return c.json({ reward: DAILY_REWARD, profile: await profileView(c.env, fresh) });
});

app.post('/api/wallet', async (c) => {
  const user = await currentUser(c);
  const body = await c.req.json<{ address?: string }>().catch(() => ({}));
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
    c.env.DB.prepare('UPDATE users SET points = points + ?, updated_at = ? WHERE id = ?').bind(task.reward, now, user.id),
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
