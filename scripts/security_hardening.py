from pathlib import Path
import json
import re

APP_URL = 'https://bluetap.hazhanhasani4268-0f9.workers.dev'


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, content: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(content)


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    s = read(path)
    actual = s.count(old)
    if actual < count:
        raise AssertionError(f'{path}: expected at least {count} occurrence(s), found {actual}: {old[:100]!r}')
    write(path, s.replace(old, new, count))


def regex_replace(path: str, pattern: str, replacement: str, count: int = 1, flags: int = 0) -> None:
    s = read(path)
    s2, n = re.subn(pattern, replacement, s, count=count, flags=flags)
    if n != count:
        raise AssertionError(f'{path}: regex replacement expected {count}, got {n}: {pattern[:100]!r}')
    write(path, s2)


# Production origin and TON Connect manifest.
wrangler = read('apps/api/wrangler.toml')
wrangler = wrangler.replace('ALLOWED_ORIGIN = "*"', f'ALLOWED_ORIGIN = "{APP_URL}"')
if f'ALLOWED_ORIGIN = "{APP_URL}"' not in wrangler:
    raise AssertionError('wrangler ALLOWED_ORIGIN replacement failed')
write('apps/api/wrangler.toml', wrangler)

write('apps/web/public/tonconnect-manifest.json', json.dumps({
    'url': APP_URL,
    'name': 'BlueTap',
    'iconUrl': 'https://raw.githubusercontent.com/hazhanhasani/BULECOIN-GRAM/main/bluecoin-logo.png',
}, ensure_ascii=False, indent=2) + '\n')

# Remove reward for spoofable wallet registration until TON Proof exists.
replace(
    'apps/api/src/game.ts',
    "  { id: 'wallet', title: 'کیف پول TON را متصل کن', reward: 500, target: 1, metric: 'wallet' },",
    "  { id: 'taps_500', title: '۵۰۰ بار ضربه بزن', reward: 500, target: 500, metric: 'taps' },",
)
replace('apps/api/src/db.ts', "    if (task.metric === 'wallet') progress = user.wallet_address ? 1 : 0;\n", '')

# Replace farmable manual-auto-confirm challenges with server-rate-limited tap goals.
replace(
    'apps/api/src/features.ts',
    "  { id: 'daily_auto_2', title: 'امروز ۲ بار ماین خودکار را دستی تأیید کن', period: 'daily', metric: 'daily_auto_confirms', target: 2, reward: 1_500 },",
    "  { id: 'daily_taps_600', title: 'امروز ۶۰۰ بار ضربه بزن', period: 'daily', metric: 'daily_taps', target: 600, reward: 1_500 },",
)
replace(
    'apps/api/src/features.ts',
    "  { id: 'weekly_auto_10', title: 'این هفته ۱۰ بار ماین خودکار را دستی تأیید کن', period: 'weekly', metric: 'weekly_auto_confirms', target: 10, reward: 8_000 },",
    "  { id: 'weekly_taps_6000', title: 'این هفته ۶٬۰۰۰ بار ضربه بزن', period: 'weekly', metric: 'weekly_taps', target: 6_000, reward: 8_000 },",
)

# Restrictive CORS: production origin, plus localhost only when dev auth is explicitly enabled.
replace('apps/api/src/index.ts', "import { cors } from 'hono/cors';\n", '')
replace(
    'apps/api/src/index.ts',
    "app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type', 'X-Dev-Telegram-Id', 'X-Dev-First-Name', 'X-Referral-Code'] }));",
    """const CORS_ALLOW_HEADERS = 'Authorization, Content-Type, X-Dev-Telegram-Id, X-Dev-First-Name, X-Referral-Code';

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || '';
  const configuredOrigin = (c.env.ALLOWED_ORIGIN || '').trim();
  const requestOrigin = new URL(c.req.url).origin;
  const localDevOrigin = c.env.ALLOW_DEV_AUTH === 'true' && /^https?:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?$/i.test(origin);
  const originAllowed = !origin || configuredOrigin === '*' || origin === configuredOrigin || origin === requestOrigin || localDevOrigin;

  if (origin && !originAllowed) return c.json({ error: 'Origin not allowed' }, 403);

  if (c.req.method === 'OPTIONS') {
    if (origin) c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Max-Age', '86400');
    return c.body(null, 204);
  }

  await next();
  if (origin) c.header('Access-Control-Allow-Origin', origin);
  c.header('Vary', 'Origin');
});""",
)

# Authoritative balances are applied first; ledger write failure does not cause a retryable reward error.
replace(
    'apps/api/src/index.ts',
    """async function currentUser(c: any): Promise<UserRow> {
  const auth = c.get('auth') as TelegramAuth;
  const { user } = await ensureUser(c.env as Env, auth);
  return user;
}
""",
    """async function currentUser(c: any): Promise<UserRow> {
  const auth = c.get('auth') as TelegramAuth;
  const { user } = await ensureUser(c.env as Env, auth);
  return user;
}

async function appendLedger(env: Env, userId: number, amount: number, kind: string, metadata: unknown, createdAt: number) {
  try {
    await env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(userId, amount, kind, JSON.stringify(metadata), createdAt)
      .run();
  } catch (error) {
    console.error('Point ledger append failed', { userId, amount, kind, error });
  }
}
""",
)

# Tap compare-and-swap: only one request can spend a given tap/energy snapshot.
tap_handler = r"""app.post('/api/tap', async (c) => {
  const user = await currentUser(c);
  const body: { count?: number } = await c.req.json<{ count?: number }>().catch(() => ({ count: 1 }));
  const requested = Math.min(MAX_TAPS_PER_REQUEST, Math.max(1, Math.floor(Number(body.count || 1))));
  const now = Date.now();
  const energy = effectiveEnergy(user, now);
  const bucket = effectiveTapBucket(user, now);
  const energyPerTap = tapRewardPerTap(user, now);
  const affordableTaps = Math.floor(energy / energyPerTap);
  const awardedTaps = Math.max(0, Math.min(requested, Math.floor(bucket), affordableTaps));

  if (awardedTaps <= 0) {
    const fresh = (await getUserByTelegramId(c.env, user.telegram_id))!;
    const currentCombo = Number(user.combo_count || 0);
    return c.json({
      awarded: 0,
      awardedTaps: 0,
      tapValue: energyPerTap,
      energySpent: 0,
      luckyBonus: 0,
      luckyHits: 0,
      highestLuckyMultiplier: 1,
      comboCount: currentCombo,
      comboMultiplier: comboMultiplierForCount(currentCombo),
      profile: await profileView(c.env, fresh),
    });
  }

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

  const updated = await c.env.DB.prepare(`
    UPDATE users
    SET points = points + ?, total_earned = total_earned + ?, taps = taps + ?, energy = ?, last_energy_at = ?,
        tap_bucket = ?, tap_bucket_at = ?, combo_count = ?, combo_last_at = ?, lucky_hits = lucky_hits + ?,
        daily_taps = daily_taps + ?, weekly_taps = weekly_taps + ?, updated_at = ?
    WHERE id = ?
      AND taps = ? AND energy = ? AND last_energy_at = ? AND tap_bucket_at = ?
      AND combo_count = ? AND combo_last_at = ?
  `).bind(
    awarded, awarded, awardedTaps, energy - energySpent, now,
    nextBucket, now, comboCount, now, luckyHits,
    awardedTaps, awardedTaps, now,
    user.id, user.taps, user.energy, user.last_energy_at, user.tap_bucket_at,
    user.combo_count, user.combo_last_at,
  ).run();

  if (!updated.meta.changes) {
    const fresh = (await getUserByTelegramId(c.env, user.telegram_id))!;
    return c.json({ error: 'Tap state changed; retry', profile: await profileView(c.env, fresh) }, 409);
  }

  await appendLedger(c.env, user.id, awarded, 'tap', {
    requested, awardedTaps, energyPerTap, energySpent, comboCount, luckyBonus,
    highestLuckyMultiplier, event: event.active ? event.name : null,
  }, now);

  const fresh = (await getUserByTelegramId(c.env, user.telegram_id))!;
  return c.json({ awarded, awardedTaps, tapValue: energyPerTap, energySpent, luckyBonus, luckyHits, highestLuckyMultiplier, comboCount, comboMultiplier: comboMultiplierForCount(comboCount), profile: await profileView(c.env, fresh) });
});
"""
regex_replace(
    'apps/api/src/index.ts',
    r"app\.post\('/api/tap',[\s\S]*?\n\}\);\n\n(?=app\.post\('/api/auto-mine/confirm')",
    tap_handler + '\n',
    flags=re.M,
)

# Daily reward compare-and-swap: the day marker acts as an atomic claim lock.
daily_handler = r"""app.post('/api/daily', async (c) => {
  const user = await currentUser(c);
  const day = utcDayKey();
  if (user.last_daily_day === day) return c.json({ error: 'Daily reward already claimed' }, 409);
  const streak = isYesterday(user.last_daily_day, day) ? Number(user.daily_streak || 0) + 1 : 1;
  const { day: streakDay, reward } = dailyRewardForStreak(streak);
  const now = Date.now();
  const updated = await c.env.DB.prepare(`
    UPDATE users
    SET points = points + ?, total_earned = total_earned + ?, last_daily_day = ?, daily_streak = ?, updated_at = ?
    WHERE id = ? AND COALESCE(last_daily_day, '') <> ?
  `).bind(reward, reward, day, streak, now, user.id, day).run();
  if (!updated.meta.changes) return c.json({ error: 'Daily reward already claimed' }, 409);
  await appendLedger(c.env, user.id, reward, 'daily', { streak, streakDay }, now);
  const fresh = (await getUserByTelegramId(c.env, user.telegram_id))!;
  return c.json({ reward, streak, streakDay, profile: await profileView(c.env, fresh) });
});
"""
regex_replace(
    'apps/api/src/index.ts',
    r"app\.post\('/api/daily',[\s\S]*?\n\}\);\n\n(?=app\.post\('/api/challenges/)",
    daily_handler + '\n',
    flags=re.M,
)

# Chest compare-and-swap: each reward type checks the exact cooldown/state snapshot.
chest_handler = r"""app.post('/api/chest/claim', async (c) => {
  const user = await currentUser(c);
  const now = Date.now();
  const settled = await settleAutoMine(c.env, user, now);
  let current = settled.user;
  const expectedLastChestAt = Number(current.last_chest_at || 0);
  const state = chestState(expectedLastChestAt, now);
  if (!state.ready) return c.json({ error: 'صندوق هنوز آماده نیست' }, 409);

  const maxEnergy = energyProgression(current).maxEnergy;
  let reward = rollChestReward(maxEnergy);
  if (reward.type === 'shield' && Number(current.mining_shields || 0) >= MAX_MINING_SHIELDS) {
    reward = { type: 'points', amount: 1_000, label: '+1,000 BP (Shield کامل بود)' };
  }

  let updated;
  if (reward.type === 'points') {
    updated = await c.env.DB.prepare(`
      UPDATE users SET points = points + ?, total_earned = total_earned + ?, last_chest_at = ?, updated_at = ?
      WHERE id = ? AND last_chest_at = ?
    `).bind(reward.amount, reward.amount, now, now, current.id, expectedLastChestAt).run();
  } else if (reward.type === 'energy') {
    const nextEnergy = Math.min(maxEnergy, effectiveEnergy(current, now) + reward.amount);
    updated = await c.env.DB.prepare(`
      UPDATE users SET energy = ?, last_energy_at = ?, last_chest_at = ?, updated_at = ?
      WHERE id = ? AND last_chest_at = ? AND energy = ? AND last_energy_at = ?
    `).bind(nextEnergy, now, now, now, current.id, expectedLastChestAt, current.energy, current.last_energy_at).run();
  } else if (reward.type === 'shield') {
    updated = await c.env.DB.prepare(`
      UPDATE users SET mining_shields = mining_shields + 1, last_chest_at = ?, updated_at = ?
      WHERE id = ? AND last_chest_at = ? AND mining_shields = ? AND mining_shields < ?
    `).bind(now, now, current.id, expectedLastChestAt, current.mining_shields, MAX_MINING_SHIELDS).run();
  } else if (reward.type === 'auto_boost') {
    const boostUntil = Math.max(now, Number(current.auto_mine_boost_until || 0)) + reward.durationMs;
    updated = await c.env.DB.prepare(`
      UPDATE users
      SET auto_mine_boost_until = ?, auto_mine_last_at = ?, auto_mine_confirmed_at = ?, last_chest_at = ?, updated_at = ?
      WHERE id = ? AND last_chest_at = ? AND auto_mine_boost_until = ?
        AND auto_mine_last_at = ? AND auto_mine_confirmed_at = ?
    `).bind(boostUntil, now, now, now, now, current.id, expectedLastChestAt,
      current.auto_mine_boost_until, current.auto_mine_last_at, current.auto_mine_confirmed_at).run();
  } else {
    const turboUntil = Math.max(now, Number(current.turbo_until || 0)) + reward.durationMs;
    updated = await c.env.DB.prepare(`
      UPDATE users SET turbo_until = ?, last_chest_at = ?, updated_at = ?
      WHERE id = ? AND last_chest_at = ? AND turbo_until = ?
    `).bind(turboUntil, now, now, current.id, expectedLastChestAt, current.turbo_until).run();
  }

  if (!updated.meta.changes) {
    current = (await getUserByTelegramId(c.env, current.telegram_id))!;
    return c.json({ error: 'وضعیت صندوق تغییر کرد؛ دوباره تلاش کن', profile: await profileView(c.env, current) }, 409);
  }

  await appendLedger(c.env, current.id, reward.type === 'points' ? reward.amount : 0, 'chest', reward, now);
  current = (await getUserByTelegramId(c.env, current.telegram_id))!;
  return c.json({ reward, burned: settled.burned, shieldUsed: settled.shieldUsed, profile: await profileView(c.env, current) });
});
"""
regex_replace(
    'apps/api/src/index.ts',
    r"app\.post\('/api/chest/claim',[\s\S]*?\n\}\);\n\n(?=app\.post\('/api/skins/)",
    chest_handler + '\n',
    flags=re.M,
)

# Leaderboards expose opaque IDs, not Telegram IDs.
regex_replace(
    'apps/api/src/db.ts',
    r"export async function leaderboard\(env: Env, limit = 20\) \{[\s\S]*?\n\}",
    """export async function leaderboard(env: Env, limit = 20) {
  const result = await env.DB.prepare('SELECT id, username, first_name, total_earned AS points FROM users ORDER BY total_earned DESC, id ASC LIMIT ?')
    .bind(Math.min(Math.max(limit, 1), 100))
    .all<{ id: number; username: string | null; first_name: string; points: number }>();
  return (result.results || []).map((row) => ({
    public_id: `p${Number(row.id).toString(36)}`,
    username: row.username,
    first_name: row.first_name,
    points: Number(row.points || 0),
  }));
}""",
    flags=re.M,
)

systems = read('apps/api/src/systems.ts')
if 'function publicPlayerId' not in systems:
    systems = systems.replace(
        "import type { Env, UserRow } from './types';\n",
        "import type { Env, UserRow } from './types';\n\nfunction publicPlayerId(id: number) {\n  return `p${Math.max(0, Math.floor(id)).toString(36)}`;\n}\n",
        1,
    )
write('apps/api/src/systems.ts', systems)

replace(
    'apps/api/src/systems.ts',
    """  const activeSince = now - JACKPOT_INTERVAL_MS;
  const active = await env.DB.prepare('SELECT id, telegram_id, first_name, username FROM users WHERE updated_at >= ? ORDER BY id ASC LIMIT 1000')
    .bind(activeSince).all<{ id: number; telegram_id: string; first_name: string; username: string | null }>();
  const players = active.results || [];
  if (!players.length) return null;
  const winner = players[randomIndex(players.length)];
""",
    """  const activeSince = now - JACKPOT_INTERVAL_MS;
  const countRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM users WHERE updated_at >= ?')
    .bind(activeSince).first<{ count: number }>();
  const activeCount = Number(countRow?.count || 0);
  if (activeCount <= 0) return null;
  const offset = randomIndex(activeCount);
  const winner = await env.DB.prepare('SELECT id, first_name, username FROM users WHERE updated_at >= ? ORDER BY id ASC LIMIT 1 OFFSET ?')
    .bind(activeSince, offset).first<{ id: number; first_name: string; username: string | null }>();
  if (!winner) return null;
""",
)
replace(
    'apps/api/src/systems.ts',
    "    `).bind(JSON.stringify({ telegramId: winner.telegram_id, name: winner.username ? `@${winner.username}` : winner.first_name, amount: pool, at: now })),",
    "    `).bind(JSON.stringify({ name: winner.username ? `@${winner.username}` : winner.first_name, amount: pool, at: now })),",
)
replace(
    'apps/api/src/systems.ts',
    "  return { winner, amount: pool };",
    "  return { winner: { public_id: publicPlayerId(winner.id), name: winner.username ? `@${winner.username}` : winner.first_name }, amount: pool };",
)

regex_replace(
    'apps/api/src/systems.ts',
    r"export async function jackpotView\(env: Env, now = Date\.now\(\)\) \{[\s\S]*?\n\}\n\n(?=export async function weeklyLeaderboard)",
    """export async function jackpotView(env: Env, now = Date.now()) {
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

""",
    flags=re.M,
)

regex_replace(
    'apps/api/src/systems.ts',
    r"export async function weeklyLeaderboard\(env: Env, now = Date\.now\(\), limit = 10\) \{[\s\S]*?\n\}",
    """export async function weeklyLeaderboard(env: Env, now = Date.now(), limit = 10) {
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
}""",
    flags=re.M,
)

replace('apps/web/src/types.ts', '  telegram_id: string;\n', '  public_id: string;\n')
replace(
    'apps/web/src/types.ts',
    '  lastWinner: { telegramId: string; name: string; amount: number; at: number } | null;\n',
    '  lastWinner: { name: string; amount: number; at: number } | null;\n',
)
app = read('apps/web/src/App.tsx').replace('key={leader.telegram_id}', 'key={leader.public_id}')
if 'leader.telegram_id' in app:
    raise AssertionError('App still references leaderboard telegram_id')
write('apps/web/src/App.tsx', app)

# Pin direct dependencies to the exact versions already recorded in the working lockfile.
write('apps/api/package.json', json.dumps({
    'name': '@bluetap/api',
    'version': '0.1.0',
    'private': True,
    'type': 'module',
    'scripts': {
        'dev': 'wrangler dev',
        'deploy': 'wrangler deploy',
        'typecheck': 'tsc --noEmit',
        'db:migrate:local': 'wrangler d1 migrations apply bluetap --local',
        'db:migrate:remote': 'wrangler d1 migrations apply bluetap --remote',
    },
    'dependencies': {'hono': '4.13.7'},
    'devDependencies': {
        '@cloudflare/workers-types': '5.20260911.1',
        'typescript': '7.0.2',
        'wrangler': '4.131.1',
    },
}, indent=2) + '\n')

write('apps/web/package.json', json.dumps({
    'name': '@bluetap/web',
    'version': '0.1.0',
    'private': True,
    'type': 'module',
    'scripts': {
        'dev': 'vite',
        'build': 'tsc -b && vite build',
        'typecheck': 'tsc -b --pretty false',
        'preview': 'vite preview',
    },
    'dependencies': {
        '@tonconnect/ui-react': '3.0.2',
        'react': '19.3.0',
        'react-dom': '19.3.0',
    },
    'devDependencies': {
        '@types/react': '19.3.0',
        '@types/react-dom': '19.3.0',
        '@vitejs/plugin-react': '6.1.1',
        'typescript': '7.0.2',
        'vite': '8.3.0',
    },
}, indent=2) + '\n')

write('package.json', json.dumps({
    'name': 'bluetap',
    'version': '0.1.0',
    'private': True,
    'workspaces': ['apps/*'],
    'scripts': {
        'dev:web': 'npm run dev -w @bluetap/web',
        'dev:api': 'npm run dev -w @bluetap/api',
        'build': 'npm run build -w @bluetap/web && npm run typecheck -w @bluetap/api',
        'typecheck': 'npm run typecheck -w @bluetap/web && npm run typecheck -w @bluetap/api',
        'test': 'node --test tests/*.test.mjs',
    },
    'engines': {'node': '>=22.12 <23'},
    'packageManager': 'npm@10.9.8',
}, indent=2) + '\n')

# Ignore generated TypeScript build metadata and remove the tracked copy.
gitignore = read('.gitignore')
if '*.tsbuildinfo' not in gitignore:
    if not gitignore.endswith('\n'):
        gitignore += '\n'
    gitignore += '*.tsbuildinfo\n'
write('.gitignore', gitignore)
Path('apps/web/tsconfig.tsbuildinfo').unlink(missing_ok=True)

# Regression tests for the vulnerabilities fixed in this hardening pass.
write('tests/security-regression.test.mjs', r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const APP_URL = 'https://bluetap.hazhanhasani4268-0f9.workers.dev';

test('production manifest and CORS are locked to the live origin', () => {
  const manifest = JSON.parse(read('apps/web/public/tonconnect-manifest.json'));
  const wrangler = read('apps/api/wrangler.toml');
  const api = read('apps/api/src/index.ts');
  assert.equal(manifest.url, APP_URL);
  assert.ok(wrangler.includes(`ALLOWED_ORIGIN = "${APP_URL}"`));
  assert.doesNotMatch(api, /cors\(\{\s*origin:\s*['"]\*['"]/);
  assert.match(api, /Origin not allowed/);
});

test('tap, daily and chest rewards use compare-and-swap guards', () => {
  const api = read('apps/api/src/index.ts');
  assert.match(api, /AND taps = \? AND energy = \? AND last_energy_at = \? AND tap_bucket_at = \?/);
  assert.match(api, /COALESCE\(last_daily_day, ''\) <> \?/);
  assert.match(api, /WHERE id = \? AND last_chest_at = \?/);
});

test('spoofable wallet and manual auto-confirm rewards are removed', () => {
  const game = read('apps/api/src/game.ts');
  const features = read('apps/api/src/features.ts');
  assert.doesNotMatch(game, /id:\s*['"]wallet['"]/);
  assert.doesNotMatch(features, /metric:\s*['"]daily_auto_confirms['"]/);
  assert.doesNotMatch(features, /metric:\s*['"]weekly_auto_confirms['"]/);
});

test('rankings do not expose Telegram IDs and jackpot samples all active users', () => {
  const db = read('apps/api/src/db.ts');
  const systems = read('apps/api/src/systems.ts');
  const types = read('apps/web/src/types.ts');
  assert.match(db, /public_id/);
  assert.match(systems, /COUNT\(\*\) AS count FROM users WHERE updated_at >= \?/);
  assert.match(systems, /LIMIT 1 OFFSET \?/);
  assert.doesNotMatch(systems, /LIMIT 1000/);
  assert.doesNotMatch(types, /telegram_id/);
});

test('direct dependencies are pinned and generated TS build info is ignored', () => {
  for (const path of ['apps/api/package.json', 'apps/web/package.json']) {
    const pkg = JSON.parse(read(path));
    for (const section of ['dependencies', 'devDependencies']) {
      for (const spec of Object.values(pkg[section] || {})) assert.notEqual(spec, 'latest');
    }
  }
  assert.match(read('.gitignore'), /\*\.tsbuildinfo/);
});
''')

# CI: locked install, regression tests, validation, deployment, production smoke test.
ci = r'''name: BlueTap CI/CD

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: bluetap-production-${{ github.ref }}
  cancel-in-progress: true

env:
  APP_URL: __APP_URL__

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 12
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: package-lock.json

      - name: Install locked dependencies
        run: npm ci

      - name: Security regression tests
        run: npm test

      - name: Typecheck
        run: npm run typecheck

      - name: Build web app
        run: npm run build

      - name: Apply D1 migrations
        if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'
        run: npx wrangler d1 migrations apply bluetap --remote --config apps/api/wrangler.toml
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Deploy production Worker
        if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'
        run: npx wrangler deploy --config apps/api/wrangler.toml
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Production smoke test
        if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'
        shell: bash
        run: |
          set -euo pipefail
          curl --fail --silent --show-error --retry 4 --retry-delay 2 "$APP_URL/health" > /tmp/health.json
          curl --fail --silent --show-error --retry 4 --retry-delay 2 "$APP_URL/tonconnect-manifest.json" > /tmp/manifest.json
          node - <<'NODE'
          const fs = require('fs');
          const health = JSON.parse(fs.readFileSync('/tmp/health.json', 'utf8'));
          const manifest = JSON.parse(fs.readFileSync('/tmp/manifest.json', 'utf8'));
          if (!health.ok) throw new Error('Production health endpoint is not OK');
          if (!health.telegramBotConfigured) throw new Error('TELEGRAM_BOT_TOKEN is not configured in production');
          if (!health.telegramWebhookSecretConfigured) throw new Error('TELEGRAM_WEBHOOK_SECRET is not configured in production');
          if (manifest.url !== process.env.APP_URL) throw new Error(`TON Connect manifest URL mismatch: ${manifest.url}`);
          console.log('Production smoke test passed');
          NODE
'''.replace('__APP_URL__', APP_URL)
write('.github/workflows/ci.yml', ci)

# Documentation matching the actual single-Worker production topology.
docs = r'''# راه‌اندازی BlueTap

## وضعیت Production

BlueTap به‌صورت یک Cloudflare Worker واحد Deploy می‌شود. Worker هم API و Webhook تلگرام را اجرا می‌کند و هم خروجی `apps/web/dist` را به‌عنوان Mini App سرو می‌کند.

- Bot: `@bluecoinxbot`
- Production URL: `__APP_URL__`
- D1 database: `bluetap`
- `ALLOW_DEV_AUTH=false` در Production
- `ALLOWED_ORIGIN=__APP_URL__`

## Secretهای لازم

این مقادیر فقط باید به‌عنوان Secret نگهداری شوند و نباید داخل GitHub یا Frontend قرار بگیرند:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
CLOUDFLARE_API_TOKEN       # GitHub Actions
CLOUDFLARE_ACCOUNT_ID      # GitHub Actions
```

## Deploy

Push روی `main`، Workflow `BlueTap CI/CD` را اجرا می‌کند:

1. `npm ci`
2. تست‌های امنیتی Regression
3. Typecheck
4. Build Mini App
5. اعمال D1 migrations
6. Deploy Worker + assets
7. Smoke test روی `/health` و `tonconnect-manifest.json`

برای Deploy دستی:

```bash
npm ci
npm test
npm run typecheck
npm run build
npx wrangler d1 migrations apply bluetap --remote --config apps/api/wrangler.toml
npx wrangler deploy --config apps/api/wrangler.toml
```

## Telegram

Webhook باید به این مسیر اشاره کند:

```text
__APP_URL__/telegram/webhook
```

در BotFather، Menu Button / Mini App URL نیز باید روی Production URL تنظیم شود.

## TON Connect

`apps/web/public/tonconnect-manifest.json` روی Production URL تنظیم شده است. اتصال ساده کیف پول فقط آدرس را ثبت می‌کند و به‌عنوان اثبات مالکیت یا شرط دریافت BLUEX استفاده نمی‌شود.

## Claim واقعی BLUEX

Claim واقعی همچنان قفل است. قبل از فعال‌سازی باید TON Proof، خزانه امن/Multisig، سقف Season، سیاست ضد Sybil، محدودیت برداشت و Idempotency نهایی شوند.
'''.replace('__APP_URL__', APP_URL)
write('docs/SETUP_FA.md', docs)

checks = {
    'placeholder manifest': 'replace-with-your-production-domain.example' not in read('apps/web/public/tonconnect-manifest.json'),
    'open cors removed': "origin: '*'" not in read('apps/api/src/index.ts'),
    'wallet reward removed': "id: 'wallet'" not in read('apps/api/src/game.ts'),
    'jackpot cap removed': 'LIMIT 1000' not in read('apps/api/src/systems.ts'),
    'telegram id removed from web leaderboard type': 'telegram_id' not in read('apps/web/src/types.ts'),
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise AssertionError('Hardening checks failed: ' + ', '.join(failed))

print('BlueTap hardening patch applied successfully')
