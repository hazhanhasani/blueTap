import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authenticateRequest } from './telegram';
import { handleTelegramUpdate } from './bot';
import {
  AUTO_MINE_BOOST_COST,
  AUTO_MINE_BOOST_DURATION_MS,
  blueHourState,
  chestState,
  COMBO_WINDOW_MS,
  comboMultiplierForCount,
  dailyRewardForStreak,
  isYesterday,
  MAX_MINING_SHIELDS,
  MINING_SHIELD_COST,
  PRESTIGE_STEP,
  prestigeMultiplier,
  rollChestReward,
  rollLuckyMultiplier,
  SKINS,
  utcDayKey,
} from './features';
import {
  autoMineLevel,
  autoMineState,
  autoMineUpgradeCost,
  effectiveEnergy,
  effectiveTapBucket,
  energyProgression,
  isTurboActive,
  MAX_TAPS_PER_REQUEST,
  TASKS,
  tapPowerLevel,
  tapPowerUpgradeCost,
  tapRewardPerTap,
  TURBO_DURATION_SECONDS,
  turboCost,
} from './game';
import { ensureUser, getUserByTelegramId, leaderboard, profileView, taskView } from './db';
import {
  challengeView,
  claimChallenge,
  claimPreviousLeagueReward,
  contributeJackpot,
  jackpotView,
  leagueView,
  maybeDrawJackpot,
  weeklyLeaderboard,
} from './systems';
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

async function settleAutoMine(env: Env, user: UserRow, now = Date.now(), manualConfirm = false) {
  const state = autoMineState(user, now);
  const expectedLastAt = Number(user.auto_mine_last_at || 0);
  const expectedConfirmedAt = Number(user.auto_mine_confirmed_at || 0);
  const confirmIncrement = manualConfirm ? 1 : 0;

  if (state.expired) {
    if (Number(user.mining_shields || 0) > 0) {
      const result = await env.DB.prepare(`
        UPDATE users
        SET points = points + ?, total_earned = total_earned + ?, mining_shields = mining_shields - 1,
            auto_mine_last_at = ?, auto_mine_confirmed_at = ?,
            daily_auto_confirms = daily_auto_confirms + ?, weekly_auto_confirms = weekly_auto_confirms + ?, updated_at = ?
        WHERE id = ? AND auto_mine_last_at = ? AND auto_mine_confirmed_at = ? AND mining_shields > 0
      `).bind(state.pending, state.pending, now, now, confirmIncrement, confirmIncrement, now, user.id, expectedLastAt, expectedConfirmedAt).run();
      if (result.meta.changes) {
        await env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(user.id, state.pending, 'auto_mine_shield', JSON.stringify({ protected: state.pending, shieldUsed: true, ratePerMinute: state.ratePerMinute }), now)
          .run();
      }
      const fresh = (await getUserByTelegramId(env, user.telegram_id))!;
      return { awarded: result.meta.changes ? state.pending : 0, burned: 0, shieldUsed: Boolean(result.meta.changes), user: fresh };
    }

    const result = await env.DB.prepare(`
      UPDATE users
      SET auto_mine_burned = auto_mine_burned + ?, auto_mine_last_at = ?, auto_mine_confirmed_at = ?,
          daily_auto_confirms = daily_auto_confirms + ?, weekly_auto_confirms = weekly_auto_confirms + ?, updated_at = ?
      WHERE id = ? AND auto_mine_last_at = ? AND auto_mine_confirmed_at = ?
    `).bind(state.pending, now, now, confirmIncrement, confirmIncrement, now, user.id, expectedLastAt, expectedConfirmedAt).run();
    if (result.meta.changes && state.pending > 0) {
      await env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, 0, ?, ?, ?)')
        .bind(user.id, 'auto_mine_burn', JSON.stringify({ burned: state.pending, missedDeadlineAt: state.deadlineAt }), now)
        .run();
    }
    const fresh = (await getUserByTelegramId(env, user.telegram_id))!;
    return { awarded: 0, burned: result.meta.changes ? state.pending : 0, shieldUsed: false, user: fresh };
  }

  const result = await env.DB.prepare(`
    UPDATE users
    SET points = points + ?, total_earned = total_earned + ?, auto_mine_last_at = ?, auto_mine_confirmed_at = ?,
        daily_auto_confirms = daily_auto_confirms + ?, weekly_auto_confirms = weekly_auto_confirms + ?, updated_at = ?
    WHERE id = ? AND auto_mine_last_at = ? AND auto_mine_confirmed_at = ?
  `).bind(state.pending, state.pending, now, now, confirmIncrement, confirmIncrement, now, user.id, expectedLastAt, expectedConfirmedAt).run();
  if (result.meta.changes && state.pending > 0) {
    await env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, state.pending, 'auto_mine', JSON.stringify({ ratePerMinute: state.ratePerMinute, level: state.level }), now)
      .run();
  }
  const fresh = (await getUserByTelegramId(env, user.telegram_id))!;
  return { awarded: result.meta.changes ? state.pending : 0, burned: 0, shieldUsed: false, user: fresh };
}

app.get('/api/bootstrap', async (c) => {
  let user = await currentUser(c);
  await maybeDrawJackpot(c.env, Date.now());
  user = (await getUserByTelegramId(c.env, user.telegram_id))!;
  const [profile, tasks, leaders, challenges, league, weeklyLeaders, jackpot] = await Promise.all([
    profileView(c.env, user),
    taskView(c.env, user),
    leaderboard(c.env, 10),
    challengeView(c.env, user),
    leagueView(c.env, user),
    weeklyLeaderboard(c.env, Date.now(), 10),
    jackpotView(c.env),
  ]);
  const inviteUrl = c.env.BOT_USERNAME ? `https://t.me/${c.env.BOT_USERNAME}?startapp=ref_${user.referral_code}` : null;
  return c.json({ profile, tasks, challenges, league, leaderboard: leaders, weeklyLeaderboard: weeklyLeaders, skins: SKINS, jackpot, inviteUrl, token: { symbol: 'BLUEX', jettonMaster: c.env.BLUEX_JETTON_MASTER }, season: { name: 'Season 1', claimEnabled: false } });
});

app.post('/api/tap', async (c) => {
  const user = await currentUser(c);
  const body: { count?: number } = await c.req.json<{ count?: number }>().catch(() => ({ count: 1 }));
  const requested = Math.min(MAX_TAPS_PER_REQUEST, Math.max(1, Math.floor(Number(body.count || 1))));
  const now = Date.now();
  const energy = effectiveEnergy(user, now);
  const bucket = effectiveTapBucket(user, now);
  const energyPerTap = tapRewardPerTap(user, now);
  const affordableTaps = Math.floor(energy / energyPerTap);
  const awardedTaps = Math.max(0, Math.min(requested, Math.floor(bucket), affordableTaps));
  const nextBucket = Math.max(0, bucket - awardedTaps);
  const event = blueHourState(now);
  const prestige = prestigeMultiplier(Number(user.prestige_level || 0));
  let comboCount = now - Number(user.combo_last_at || 0) <= COMBO_WINDOW_MS ? Number(user.combo_count || 0) : 0;
  let awarded = 0;
  let luckyBonus = 0;
  let luckyHits = 0;
  let highestLuckyMultiplier = 1;
  for (let i = 0; i < awardedTaps; i += 1) {
    comboCount += 1;
    const comboMultiplier = comboMultiplierForCount(comboCount);
    const normalReward = Math.max(1, Math.floor(energyPerTap * comboMultiplier * event.tapMultiplier * prestige));
    const luckyMultiplier = rollLuckyMultiplier();
    if (luckyMultiplier > 1) {
      luckyHits += 1;
      highestLuckyMultiplier = Math.max(highestLuckyMultiplier, luckyMultiplier);
      luckyBonus += normalReward * (luckyMultiplier - 1);
    }
    awarded += normalReward * luckyMultiplier;
  }
  const energySpent = awardedTaps * energyPerTap;
  await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE users
      SET points = points + ?, total_earned = total_earned + ?, taps = taps + ?, energy = ?, last_energy_at = ?,
          tap_bucket = ?, tap_bucket_at = ?, combo_count = ?, combo_last_at = ?, lucky_hits = lucky_hits + ?,
          daily_taps = daily_taps + ?, weekly_taps = weekly_taps + ?, updated_at = ?
      WHERE id = ?
    `).bind(awarded, awarded, awardedTaps, energy - energySpent, now, nextBucket, now, comboCount, now, luckyHits, awardedTaps, awardedTaps, now, user.id),
    c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, awarded, 'tap', JSON.stringify({ requested, awardedTaps, energyPerTap, energySpent, comboCount, luckyBonus, highestLuckyMultiplier, event: event.active ? event.name : null }), now),
  ]);
  const fresh = (await getUserByTelegramId(c.env, user.telegram_id))!;
  return c.json({ awarded, awardedTaps, tapValue: energyPerTap, energySpent, luckyBonus, luckyHits, highestLuckyMultiplier, comboCount, comboMultiplier: comboMultiplierForCount(comboCount), profile: await profileView(c.env, fresh) });
});

app.post('/api/auto-mine/confirm', async (c) => {
  const user = await currentUser(c);
  const body: { manual?: boolean } = await c.req.json<{ manual?: boolean }>().catch(() => ({ manual: true }));
  const result = await settleAutoMine(c.env, user, Date.now(), body.manual !== false);
  return c.json({ awarded: result.awarded, burned: result.burned, shieldUsed: result.shieldUsed, profile: await profileView(c.env, result.user) });
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
    UPDATE users SET points = points - ?, auto_mine_level = auto_mine_level + 1, auto_mine_last_at = ?, auto_mine_confirmed_at = ?, updated_at = ?
    WHERE id = ? AND points >= ? AND auto_mine_level = ?
  `).bind(cost, now, now, now, current.id, cost, level).run();
  if (!result.meta.changes) return c.json({ error: 'ارتقای ماین خودکار انجام نشد؛ دوباره تلاش کن' }, 409);
  await Promise.all([
    c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)').bind(current.id, -cost, 'upgrade_auto_mine', JSON.stringify({ from: level, to: level + 1 }), now).run(),
    contributeJackpot(c.env, cost),
  ]);
  const fresh = (await getUserByTelegramId(c.env, current.telegram_id))!;
  return c.json({ cost, settledAwarded: settled.awarded, burned: settled.burned, profile: await profileView(c.env, fresh) });
});

app.post('/api/upgrades/tap-power', async (c) => {
  const user = await currentUser(c);
  const level = tapPowerLevel(user);
  const cost = tapPowerUpgradeCost(level);
  if (cost === null) return c.json({ error: 'Maximum tap power reached' }, 409);
  if (user.points < cost) return c.json({ error: 'Blue Points کافی نیست' }, 409);
  const now = Date.now();
  const result = await c.env.DB.prepare('UPDATE users SET points = points - ?, tap_power_level = tap_power_level + 1, updated_at = ? WHERE id = ? AND points >= ? AND tap_power_level = ?').bind(cost, now, user.id, cost, level).run();
  if (!result.meta.changes) return c.json({ error: 'ارتقا انجام نشد؛ دوباره تلاش کن' }, 409);
  await Promise.all([
    c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)').bind(user.id, -cost, 'upgrade_tap_power', JSON.stringify({ from: level, to: level + 1 }), now).run(),
    contributeJackpot(c.env, cost),
  ]);
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
    UPDATE users SET points = points - ?, turbo_until = ?, daily_turbo_uses = daily_turbo_uses + 1, weekly_turbo_uses = weekly_turbo_uses + 1, updated_at = ?
    WHERE id = ? AND points >= ? AND turbo_until <= ?
  `).bind(cost, turboUntil, now, user.id, cost, now).run();
  if (!result.meta.changes) return c.json({ error: 'فعال‌سازی توربو انجام نشد؛ دوباره تلاش کن' }, 409);
  await Promise.all([
    c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)').bind(user.id, -cost, 'turbo', JSON.stringify({ durationSeconds: TURBO_DURATION_SECONDS, turboUntil }), now).run(),
    contributeJackpot(c.env, cost),
  ]);
  const fresh = (await getUserByTelegramId(c.env, user.telegram_id))!;
  return c.json({ cost, profile: await profileView(c.env, fresh) });
});

app.post('/api/boosters/auto-mine', async (c) => {
  const user = await currentUser(c);
  const now = Date.now();
  const settled = await settleAutoMine(c.env, user, now);
  const current = settled.user;
  if (current.points < AUTO_MINE_BOOST_COST) return c.json({ error: 'Blue Points کافی نیست' }, 409);
  const boostUntil = Math.max(now, Number(current.auto_mine_boost_until || 0)) + AUTO_MINE_BOOST_DURATION_MS;
  const result = await c.env.DB.prepare('UPDATE users SET points = points - ?, auto_mine_boost_until = ?, auto_mine_last_at = ?, auto_mine_confirmed_at = ?, updated_at = ? WHERE id = ? AND points >= ?').bind(AUTO_MINE_BOOST_COST, boostUntil, now, now, now, current.id, AUTO_MINE_BOOST_COST).run();
  if (!result.meta.changes) return c.json({ error: 'فعال‌سازی Booster انجام نشد' }, 409);
  await Promise.all([
    c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)').bind(current.id, -AUTO_MINE_BOOST_COST, 'auto_mine_booster', JSON.stringify({ boostUntil }), now).run(),
    contributeJackpot(c.env, AUTO_MINE_BOOST_COST),
  ]);
  const fresh = (await getUserByTelegramId(c.env, current.telegram_id))!;
  return c.json({ profile: await profileView(c.env, fresh), settledAwarded: settled.awarded });
});

app.post('/api/shop/mining-shield', async (c) => {
  const user = await currentUser(c);
  if (Number(user.mining_shields || 0) >= MAX_MINING_SHIELDS) return c.json({ error: 'حداکثر Mining Shield را داری' }, 409);
  if (user.points < MINING_SHIELD_COST) return c.json({ error: 'Blue Points کافی نیست' }, 409);
  const now = Date.now();
  const result = await c.env.DB.prepare('UPDATE users SET points = points - ?, mining_shields = mining_shields + 1, updated_at = ? WHERE id = ? AND points >= ? AND mining_shields < ?').bind(MINING_SHIELD_COST, now, user.id, MINING_SHIELD_COST, MAX_MINING_SHIELDS).run();
  if (!result.meta.changes) return c.json({ error: 'خرید Shield انجام نشد' }, 409);
  await Promise.all([
    c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)').bind(user.id, -MINING_SHIELD_COST, 'mining_shield', JSON.stringify({ quantity: 1 }), now).run(),
    contributeJackpot(c.env, MINING_SHIELD_COST),
  ]);
  const fresh = (await getUserByTelegramId(c.env, user.telegram_id))!;
  return c.json({ profile: await profileView(c.env, fresh) });
});

app.post('/api/prestige', async (c) => {
  const user = await currentUser(c);
  const now = Date.now();
  const settled = await settleAutoMine(c.env, user, now);
  const current = settled.user;
  const prestigeLevel = Number(current.prestige_level || 0);
  const requirement = PRESTIGE_STEP * (prestigeLevel + 1);
  if (Number(current.total_earned || 0) < requirement) return c.json({ error: 'برای Prestige هنوز کل استخراج کافی نیست' }, 409);
  const spentPoints = Number(current.points || 0);
  await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE users SET points = 0, tap_power_level = 1, auto_mine_level = 1, prestige_level = prestige_level + 1,
          combo_count = 0, combo_last_at = 0, turbo_until = 0, auto_mine_boost_until = 0,
          auto_mine_last_at = ?, auto_mine_confirmed_at = ?, updated_at = ?
      WHERE id = ? AND prestige_level = ?
    `).bind(now, now, now, current.id, prestigeLevel),
    c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)').bind(current.id, -spentPoints, 'prestige', JSON.stringify({ from: prestigeLevel, to: prestigeLevel + 1, resetPoints: spentPoints }), now),
  ]);
  const fresh = (await getUserByTelegramId(c.env, current.telegram_id))!;
  return c.json({ profile: await profileView(c.env, fresh), settledAwarded: settled.awarded });
});

app.post('/api/chest/claim', async (c) => {
  const user = await currentUser(c);
  const now = Date.now();
  const settled = await settleAutoMine(c.env, user, now);
  let current = settled.user;
  const state = chestState(Number(current.last_chest_at || 0), now);
  if (!state.ready) return c.json({ error: 'صندوق هنوز آماده نیست' }, 409);
  const maxEnergy = energyProgression(current).maxEnergy;
  let reward = rollChestReward(maxEnergy);
  if (reward.type === 'shield' && Number(current.mining_shields || 0) >= MAX_MINING_SHIELDS) reward = { type: 'points', amount: 1_000, label: '+1,000 BP (Shield کامل بود)' };
  const statements: any[] = [];
  if (reward.type === 'points') statements.push(c.env.DB.prepare('UPDATE users SET points = points + ?, total_earned = total_earned + ?, last_chest_at = ?, updated_at = ? WHERE id = ?').bind(reward.amount, reward.amount, now, now, current.id));
  else if (reward.type === 'energy') {
    const nextEnergy = Math.min(maxEnergy, effectiveEnergy(current, now) + reward.amount);
    statements.push(c.env.DB.prepare('UPDATE users SET energy = ?, last_energy_at = ?, last_chest_at = ?, updated_at = ? WHERE id = ?').bind(nextEnergy, now, now, now, current.id));
  } else if (reward.type === 'shield') statements.push(c.env.DB.prepare('UPDATE users SET mining_shields = mining_shields + 1, last_chest_at = ?, updated_at = ? WHERE id = ?').bind(now, now, current.id));
  else if (reward.type === 'auto_boost') {
    const boostUntil = Math.max(now, Number(current.auto_mine_boost_until || 0)) + reward.durationMs;
    statements.push(c.env.DB.prepare('UPDATE users SET auto_mine_boost_until = ?, auto_mine_last_at = ?, auto_mine_confirmed_at = ?, last_chest_at = ?, updated_at = ? WHERE id = ?').bind(boostUntil, now, now, now, now, current.id));
  } else {
    const turboUntil = Math.max(now, Number(current.turbo_until || 0)) + reward.durationMs;
    statements.push(c.env.DB.prepare('UPDATE users SET turbo_until = ?, last_chest_at = ?, updated_at = ? WHERE id = ?').bind(turboUntil, now, now, current.id));
  }
  const ledgerAmount = reward.type === 'points' ? reward.amount : 0;
  statements.push(c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)').bind(current.id, ledgerAmount, 'chest', JSON.stringify(reward), now));
  await c.env.DB.batch(statements);
  current = (await getUserByTelegramId(c.env, current.telegram_id))!;
  return c.json({ reward, burned: settled.burned, shieldUsed: settled.shieldUsed, profile: await profileView(c.env, current) });
});

app.post('/api/skins/:skinId', async (c) => {
  const user = await currentUser(c);
  const skinId = c.req.param('skinId');
  const skin = SKINS.find((item) => item.id === skinId);
  if (!skin) return c.json({ error: 'Skin not found' }, 404);
  let unlocked: string[] = ['blue'];
  try { unlocked = Array.from(new Set(['blue', ...JSON.parse(user.unlocked_skins || '[]').map(String)])); } catch {}
  const now = Date.now();
  if (!unlocked.includes(skin.id)) {
    if (user.points < skin.cost) return c.json({ error: 'Blue Points کافی نیست' }, 409);
    unlocked.push(skin.id);
    const result = await c.env.DB.prepare('UPDATE users SET points = points - ?, unlocked_skins = ?, selected_skin = ?, updated_at = ? WHERE id = ? AND points >= ?').bind(skin.cost, JSON.stringify(unlocked), skin.id, now, user.id, skin.cost).run();
    if (!result.meta.changes) return c.json({ error: 'خرید Skin انجام نشد' }, 409);
    await Promise.all([
      c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)').bind(user.id, -skin.cost, 'skin_purchase', JSON.stringify({ skinId }), now).run(),
      contributeJackpot(c.env, skin.cost),
    ]);
  } else await c.env.DB.prepare('UPDATE users SET selected_skin = ?, updated_at = ? WHERE id = ?').bind(skin.id, now, user.id).run();
  const fresh = (await getUserByTelegramId(c.env, user.telegram_id))!;
  return c.json({ profile: await profileView(c.env, fresh) });
});

app.post('/api/daily', async (c) => {
  const user = await currentUser(c);
  const day = utcDayKey();
  if (user.last_daily_day === day) return c.json({ error: 'Daily reward already claimed' }, 409);
  const streak = isYesterday(user.last_daily_day, day) ? Number(user.daily_streak || 0) + 1 : 1;
  const { day: streakDay, reward } = dailyRewardForStreak(streak);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET points = points + ?, total_earned = total_earned + ?, last_daily_day = ?, daily_streak = ?, updated_at = ? WHERE id = ?').bind(reward, reward, day, streak, now, user.id),
    c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)').bind(user.id, reward, 'daily', JSON.stringify({ streak, streakDay }), now),
  ]);
  const fresh = (await getUserByTelegramId(c.env, user.telegram_id))!;
  return c.json({ reward, streak, streakDay, profile: await profileView(c.env, fresh) });
});

app.post('/api/challenges/:challengeId/claim', async (c) => {
  const user = await currentUser(c);
  const result = await claimChallenge(c.env, user, c.req.param('challengeId'));
  if ('error' in result) return c.json({ error: result.error }, result.status);
  return c.json({ reward: result.reward, profile: await profileView(c.env, result.user), challenges: await challengeView(c.env, result.user) });
});

app.post('/api/league/claim', async (c) => {
  const user = await currentUser(c);
  const result = await claimPreviousLeagueReward(c.env, user);
  if ('error' in result) return c.json({ error: result.error }, result.status);
  return c.json({ reward: result.reward, profile: await profileView(c.env, result.user), league: await leagueView(c.env, result.user) });
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
  const inserted = await c.env.DB.prepare('INSERT OR IGNORE INTO task_claims (user_id, task_id, reward, created_at) VALUES (?, ?, ?, ?)').bind(user.id, task.id, task.reward, now).run();
  if (!inserted.meta.changes) return c.json({ error: 'Task already claimed' }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET points = points + ?, total_earned = total_earned + ?, updated_at = ? WHERE id = ?').bind(task.reward, task.reward, now, user.id),
    c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)').bind(user.id, task.reward, 'task', JSON.stringify({ taskId }), now),
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
