from pathlib import Path

OWNER_ID = '8636742848'


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, content: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(content)


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    text = read(path)
    found = text.count(old)
    if found < count:
        raise AssertionError(f'{path}: expected {count} occurrence(s), found {found}: {old[:120]!r}')
    write(path, text.replace(old, new, count))


# Central owner identity helper. Telegram authentication remains mandatory;
# only the authenticated owner account receives unrestricted game privileges.
write('apps/api/src/owner.ts', f"""import type {{ Env, UserRow }} from './types';

export const DEFAULT_OWNER_TELEGRAM_ID = '{OWNER_ID}';

export function ownerTelegramId(env: Env) {{
  return String(env.OWNER_TELEGRAM_ID || DEFAULT_OWNER_TELEGRAM_ID).trim();
}}

export function isOwner(env: Env, userOrId: UserRow | string | number) {{
  const id = typeof userOrId === 'object' ? userOrId.telegram_id : String(userOrId);
  return id === ownerTelegramId(env);
}}
""")

replace(
    'apps/api/src/types.ts',
    '  BOT_USERNAME?: string;\n}',
    '  BOT_USERNAME?: string;\n  OWNER_TELEGRAM_ID?: string;\n}',
)

replace(
    'apps/api/wrangler.toml',
    'BOT_USERNAME = "bluecoinxbot"\n',
    f'BOT_USERNAME = "bluecoinxbot"\nOWNER_TELEGRAM_ID = "{OWNER_ID}"\n',
)

# Allow stored owner upgrade levels to go past public caps. Public endpoints still
# enforce the caps; only owner-mode endpoint branches can increment beyond them.
replace(
    'apps/api/src/game.ts',
    "export function tapPowerLevel(user: UserRow) {\n  return Math.min(MAX_TAP_POWER, Math.max(1, Number(user.tap_power_level || 1)));\n}",
    "export function tapPowerLevel(user: UserRow) {\n  return Math.max(1, Math.floor(Number(user.tap_power_level || 1)));\n}",
)
replace(
    'apps/api/src/game.ts',
    "export function autoMineLevel(user: UserRow) {\n  return Math.min(MAX_AUTO_MINE_LEVEL, Math.max(1, Number(user.auto_mine_level || 1)));\n}",
    "export function autoMineLevel(user: UserRow) {\n  return Math.max(1, Math.floor(Number(user.auto_mine_level || 1)));\n}",
)
replace(
    'apps/api/src/game.ts',
    "    ? Math.min(MAX_AUTO_MINE_LEVEL, Math.max(1, Math.floor(userOrLevel || 1)))\n",
    "    ? Math.max(1, Math.floor(userOrLevel || 1))\n",
)
replace(
    'apps/api/src/game.ts',
    'export function autoMineState(user: UserRow, now = Date.now()) {',
    'export function autoMineState(user: UserRow, now = Date.now(), unlimited = false) {',
)
replace(
    'apps/api/src/game.ts',
    '  const deadlineAt = confirmedAt + AUTO_MINE_CONFIRM_WINDOW_SECONDS * 1000;\n  const accrualEnd = Math.min(now, deadlineAt);',
    '  const deadlineAt = unlimited ? Number.MAX_SAFE_INTEGER : confirmedAt + AUTO_MINE_CONFIRM_WINDOW_SECONDS * 1000;\n  const accrualEnd = unlimited ? now : Math.min(now, deadlineAt);',
)
replace(
    'apps/api/src/game.ts',
    '  const expired = now >= deadlineAt;',
    '  const expired = unlimited ? false : now >= deadlineAt;',
)
replace(
    'apps/api/src/game.ts',
    '    remainingSeconds: expired ? 0 : Math.max(0, Math.ceil((deadlineAt - now) / 1000)),',
    '    remainingSeconds: unlimited ? Number.MAX_SAFE_INTEGER : expired ? 0 : Math.max(0, Math.ceil((deadlineAt - now) / 1000)),',
)

# Profile/task projection exposes an ownerMode flag and removes visible limits.
replace(
    'apps/api/src/db.ts',
    '  PRESTIGE_STEP,\n} from \'./features\';',
    '  PRESTIGE_STEP,\n  SKINS,\n} from \'./features\';',
)
replace(
    'apps/api/src/db.ts',
    "import { normalizeActivityCounters } from './systems';",
    "import { isOwner } from './owner';\nimport { normalizeActivityCounters } from './systems';",
)
replace(
    'apps/api/src/db.ts',
    "export async function taskView(env: Env, user: UserRow) {\n  const [refs, claimed] = await Promise.all([referralCount(env, user.id), claimedTaskIds(env, user.id)]);\n  return TASKS.map((task) => {",
    "export async function taskView(env: Env, user: UserRow) {\n  const ownerMode = isOwner(env, user);\n  const [refs, claimed] = await Promise.all([referralCount(env, user.id), claimedTaskIds(env, user.id)]);\n  return TASKS.map((task) => {",
)
replace(
    'apps/api/src/db.ts',
    "    return { ...task, progress: Math.min(progress, task.target), completed: progress >= task.target, claimed: claimed.has(task.id) };",
    "    if (ownerMode) return { ...task, progress: task.target, completed: true, claimed: false };\n    return { ...task, progress: Math.min(progress, task.target), completed: progress >= task.target, claimed: claimed.has(task.id) };",
)
replace(
    'apps/api/src/db.ts',
    "  const normalized = await normalizeActivityCounters(env, user, now);\n  const refs = await referralCount(env, normalized.id);",
    "  const normalized = await normalizeActivityCounters(env, user, now);\n  const ownerMode = isOwner(env, normalized);\n  const refs = await referralCount(env, normalized.id);",
)
replace(
    'apps/api/src/db.ts',
    '  const autoMine = autoMineState(normalized, now);',
    '  const autoMine = autoMineState(normalized, now, ownerMode);',
)
replace(
    'apps/api/src/db.ts',
    '  const chest = chestState(Number(normalized.last_chest_at || 0), now);',
    '  const chest = ownerMode ? { ready: true, nextAt: now, remainingSeconds: 0 } : chestState(Number(normalized.last_chest_at || 0), now);',
)
replace(
    'apps/api/src/db.ts',
    '  return {\n    id: normalized.telegram_id,',
    '  return {\n    ownerMode,\n    id: normalized.telegram_id,',
)
replace(
    'apps/api/src/db.ts',
    '    energy: effectiveEnergy(normalized, now),',
    '    energy: ownerMode ? Number.MAX_SAFE_INTEGER : effectiveEnergy(normalized, now),',
)
replace(
    'apps/api/src/db.ts',
    '    canClaimDaily: normalized.last_daily_day !== utcDay(now),',
    '    canClaimDaily: ownerMode || normalized.last_daily_day !== utcDay(now),',
)
replace(
    'apps/api/src/db.ts',
    '    tapPowerUpgradeCost: tapPowerUpgradeCost(powerLevel),\n    maxTapPower: MAX_TAP_POWER,',
    '    tapPowerUpgradeCost: ownerMode ? 0 : tapPowerUpgradeCost(powerLevel),\n    maxTapPower: ownerMode ? Number.MAX_SAFE_INTEGER : MAX_TAP_POWER,',
)
replace(
    'apps/api/src/db.ts',
    '    turboCost: turboCost(normalized),',
    '    turboCost: ownerMode ? 0 : turboCost(normalized),',
)
replace(
    'apps/api/src/db.ts',
    '    autoMineUpgradeCost: autoMineUpgradeCost(autoMine.level),\n    maxAutoMineLevel: MAX_AUTO_MINE_LEVEL,',
    '    autoMineUpgradeCost: ownerMode ? 0 : autoMineUpgradeCost(autoMine.level),\n    maxAutoMineLevel: ownerMode ? Number.MAX_SAFE_INTEGER : MAX_AUTO_MINE_LEVEL,',
)
replace(
    'apps/api/src/db.ts',
    '    autoMineBoostCost: AUTO_MINE_BOOST_COST,',
    '    autoMineBoostCost: ownerMode ? 0 : AUTO_MINE_BOOST_COST,',
)
replace(
    'apps/api/src/db.ts',
    '    miningShieldCost: MINING_SHIELD_COST,\n    maxMiningShields: MAX_MINING_SHIELDS,',
    '    miningShieldCost: ownerMode ? 0 : MINING_SHIELD_COST,\n    maxMiningShields: ownerMode ? Number.MAX_SAFE_INTEGER : MAX_MINING_SHIELDS,',
)
replace(
    'apps/api/src/db.ts',
    '    canPrestige: totalEarned >= prestigeRequirement,',
    '    canPrestige: ownerMode || totalEarned >= prestigeRequirement,',
)
replace(
    'apps/api/src/db.ts',
    "    unlockedSkins: parseUnlockedSkins(normalized.unlocked_skins),",
    "    unlockedSkins: ownerMode ? SKINS.map((skin) => skin.id) : parseUnlockedSkins(normalized.unlocked_skins),",
)

# Challenges and league rewards are always actionable for the authenticated owner.
replace(
    'apps/api/src/systems.ts',
    "import type { Env, UserRow } from './types';",
    "import { isOwner } from './owner';\nimport type { Env, UserRow } from './types';",
)
replace(
    'apps/api/src/systems.ts',
    "export async function challengeView(env: Env, user: UserRow, now = Date.now()) {\n  const normalized = await normalizeActivityCounters(env, user, now);",
    "export async function challengeView(env: Env, user: UserRow, now = Date.now()) {\n  const normalized = await normalizeActivityCounters(env, user, now);\n  const ownerMode = isOwner(env, normalized);",
)
replace(
    'apps/api/src/systems.ts',
    "    return {\n      ...challenge,\n      periodKey,\n      progress: Math.min(progress, challenge.target),\n      completed: progress >= challenge.target,\n      claimed: claimed.has(`${challenge.id}:${periodKey}`),\n    };",
    "    if (ownerMode) return { ...challenge, periodKey, progress: challenge.target, completed: true, claimed: false };\n    return {\n      ...challenge,\n      periodKey,\n      progress: Math.min(progress, challenge.target),\n      completed: progress >= challenge.target,\n      claimed: claimed.has(`${challenge.id}:${periodKey}`),\n    };",
)
replace(
    'apps/api/src/systems.ts',
    "  const normalized = await normalizeActivityCounters(env, user, now);\n  const progress = metricProgress(normalized, challenge.metric);\n  if (progress < challenge.target) return { error: 'Challenge is not completed yet', status: 400 as const };",
    "  const normalized = await normalizeActivityCounters(env, user, now);\n  const ownerMode = isOwner(env, normalized);\n  const progress = metricProgress(normalized, challenge.metric);\n  if (!ownerMode && progress < challenge.target) return { error: 'Challenge is not completed yet', status: 400 as const };\n  if (ownerMode) {\n    await env.DB.batch([\n      env.DB.prepare('UPDATE users SET points = points + ?, total_earned = total_earned + ?, updated_at = ? WHERE id = ?').bind(challenge.reward, challenge.reward, now, normalized.id),\n      env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)').bind(normalized.id, challenge.reward, 'owner_challenge', JSON.stringify({ challengeId }), now),\n    ]);\n    const fresh = (await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(normalized.id).first<UserRow>())!;\n    return { reward: challenge.reward, user: fresh };\n  }",
)
replace(
    'apps/api/src/systems.ts',
    "  return {\n    current: { id: current.id, name: current.name, points: currentPoints, nextMin: current.nextMin, nextName: current.nextName },\n    previous: {\n      weekKey: previousRange.key,\n      id: previous.id,\n      name: previous.name,\n      points: previousPoints,\n      reward: previousPoints > 0 ? previous.reward : 0,\n      claimable: previousPoints > 0 && !claimed,\n      claimed: Boolean(claimed),\n    },\n  };",
    "  const ownerMode = isOwner(env, user);\n  return {\n    current: { id: current.id, name: current.name, points: currentPoints, nextMin: current.nextMin, nextName: current.nextName },\n    previous: {\n      weekKey: previousRange.key,\n      id: previous.id,\n      name: previous.name,\n      points: previousPoints,\n      reward: ownerMode ? previous.reward : previousPoints > 0 ? previous.reward : 0,\n      claimable: ownerMode || (previousPoints > 0 && !claimed),\n      claimed: ownerMode ? false : Boolean(claimed),\n    },\n  };",
)
replace(
    'apps/api/src/systems.ts',
    "export async function claimPreviousLeagueReward(env: Env, user: UserRow, now = Date.now()) {\n  const state = await leagueView(env, user, now);",
    "export async function claimPreviousLeagueReward(env: Env, user: UserRow, now = Date.now()) {\n  const state = await leagueView(env, user, now);\n  if (isOwner(env, user)) {\n    const reward = Math.max(1, state.previous.reward);\n    await env.DB.batch([\n      env.DB.prepare('UPDATE users SET points = points + ?, total_earned = total_earned + ?, updated_at = ? WHERE id = ?').bind(reward, reward, now, user.id),\n      env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)').bind(user.id, reward, 'owner_league_reward', JSON.stringify({ weekKey: state.previous.weekKey, league: state.previous.id }), now),\n    ]);\n    const fresh = (await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<UserRow>())!;\n    return { reward, user: fresh };\n  }",
)

# API owner branches: unlimited taps/energy, no costs/cooldowns/caps.
replace(
    'apps/api/src/index.ts',
    "import { ensureUser, getUserByTelegramId, leaderboard, profileView, taskView } from './db';",
    "import { ensureUser, getUserByTelegramId, leaderboard, profileView, taskView } from './db';\nimport { isOwner } from './owner';",
)
replace(
    'apps/api/src/index.ts',
    '  const state = autoMineState(user, now);',
    '  const state = autoMineState(user, now, isOwner(env, user));',
)
replace(
    'apps/api/src/index.ts',
    "  const body: { count?: number } = await c.req.json<{ count?: number }>().catch(() => ({ count: 1 }));\n  const requested = Math.min(MAX_TAPS_PER_REQUEST, Math.max(1, Math.floor(Number(body.count || 1))));\n  const now = Date.now();\n  const energy = effectiveEnergy(user, now);\n  const bucket = effectiveTapBucket(user, now);\n  const energyPerTap = tapRewardPerTap(user, now);\n  const affordableTaps = Math.floor(energy / energyPerTap);\n  const awardedTaps = Math.max(0, Math.min(requested, Math.floor(bucket), affordableTaps));",
    "  const body: { count?: number } = await c.req.json<{ count?: number }>().catch(() => ({ count: 1 }));\n  const ownerMode = isOwner(c.env, user);\n  const rawRequested = Math.max(1, Math.floor(Number(body.count || 1)));\n  const requested = ownerMode ? Math.min(rawRequested, 10_000) : Math.min(MAX_TAPS_PER_REQUEST, rawRequested);\n  const now = Date.now();\n  const energy = effectiveEnergy(user, now);\n  const bucket = effectiveTapBucket(user, now);\n  const energyPerTap = tapRewardPerTap(user, now);\n  const affordableTaps = ownerMode ? requested : Math.floor(energy / energyPerTap);\n  const awardedTaps = ownerMode ? requested : Math.max(0, Math.min(requested, Math.floor(bucket), affordableTaps));",
)
replace(
    'apps/api/src/index.ts',
    '  const nextBucket = Math.max(0, bucket - awardedTaps);',
    '  const nextBucket = ownerMode ? Number(user.tap_bucket || 0) : Math.max(0, bucket - awardedTaps);',
)
replace(
    'apps/api/src/index.ts',
    '  const energySpent = awardedTaps * energyPerTap;',
    '  const energySpent = ownerMode ? 0 : awardedTaps * energyPerTap;\n  const nextEnergy = ownerMode ? Number(user.energy || 0) : energy - energySpent;',
)
replace(
    'apps/api/src/index.ts',
    '    awarded, awarded, awardedTaps, energy - energySpent, now,',
    '    awarded, awarded, awardedTaps, nextEnergy, now,',
)

replace(
    'apps/api/src/index.ts',
    "  const level = autoMineLevel(current);\n  const cost = autoMineUpgradeCost(level);\n  if (cost === null) return c.json({ error: 'Maximum auto-mine level reached' }, 409);\n  if (current.points < cost) return c.json({ error: 'Blue Points کافی نیست' }, 409);",
    "  const ownerMode = isOwner(c.env, current);\n  const level = autoMineLevel(current);\n  const cost = ownerMode ? 0 : autoMineUpgradeCost(level);\n  if (cost === null) return c.json({ error: 'Maximum auto-mine level reached' }, 409);\n  if (!ownerMode && current.points < cost) return c.json({ error: 'Blue Points کافی نیست' }, 409);",
)
replace(
    'apps/api/src/index.ts',
    "  const level = tapPowerLevel(user);\n  const cost = tapPowerUpgradeCost(level);\n  if (cost === null) return c.json({ error: 'Maximum tap power reached' }, 409);\n  if (user.points < cost) return c.json({ error: 'Blue Points کافی نیست' }, 409);",
    "  const ownerMode = isOwner(c.env, user);\n  const level = tapPowerLevel(user);\n  const cost = ownerMode ? 0 : tapPowerUpgradeCost(level);\n  if (cost === null) return c.json({ error: 'Maximum tap power reached' }, 409);\n  if (!ownerMode && user.points < cost) return c.json({ error: 'Blue Points کافی نیست' }, 409);",
)

replace(
    'apps/api/src/index.ts',
    "  const user = await currentUser(c);\n  const now = Date.now();\n  if (isTurboActive(user, now)) return c.json({ error: 'توربو همین حالا فعال است' }, 409);\n  const cost = turboCost(user);\n  if (user.points < cost) return c.json({ error: 'Blue Points کافی نیست' }, 409);\n  const turboUntil = now + TURBO_DURATION_SECONDS * 1000;\n  const result = await c.env.DB.prepare(`\n    UPDATE users SET points = points - ?, turbo_until = ?, daily_turbo_uses = daily_turbo_uses + 1, weekly_turbo_uses = weekly_turbo_uses + 1, updated_at = ?\n    WHERE id = ? AND points >= ? AND turbo_until <= ?\n  `).bind(cost, turboUntil, now, user.id, cost, now).run();",
    "  const user = await currentUser(c);\n  const now = Date.now();\n  const ownerMode = isOwner(c.env, user);\n  if (!ownerMode && isTurboActive(user, now)) return c.json({ error: 'توربو همین حالا فعال است' }, 409);\n  const cost = ownerMode ? 0 : turboCost(user);\n  if (!ownerMode && user.points < cost) return c.json({ error: 'Blue Points کافی نیست' }, 409);\n  const turboUntil = (ownerMode ? Math.max(now, Number(user.turbo_until || 0)) : now) + TURBO_DURATION_SECONDS * 1000;\n  const result = ownerMode\n    ? await c.env.DB.prepare('UPDATE users SET turbo_until = ?, daily_turbo_uses = daily_turbo_uses + 1, weekly_turbo_uses = weekly_turbo_uses + 1, updated_at = ? WHERE id = ?').bind(turboUntil, now, user.id).run()\n    : await c.env.DB.prepare(`\n      UPDATE users SET points = points - ?, turbo_until = ?, daily_turbo_uses = daily_turbo_uses + 1, weekly_turbo_uses = weekly_turbo_uses + 1, updated_at = ?\n      WHERE id = ? AND points >= ? AND turbo_until <= ?\n    `).bind(cost, turboUntil, now, user.id, cost, now).run();",
)

replace(
    'apps/api/src/index.ts',
    "  const current = settled.user;\n  if (current.points < AUTO_MINE_BOOST_COST) return c.json({ error: 'Blue Points کافی نیست' }, 409);\n  const boostUntil = Math.max(now, Number(current.auto_mine_boost_until || 0)) + AUTO_MINE_BOOST_DURATION_MS;\n  const result = await c.env.DB.prepare('UPDATE users SET points = points - ?, auto_mine_boost_until = ?, auto_mine_last_at = ?, auto_mine_confirmed_at = ?, updated_at = ? WHERE id = ? AND points >= ?').bind(AUTO_MINE_BOOST_COST, boostUntil, now, now, now, current.id, AUTO_MINE_BOOST_COST).run();",
    "  const current = settled.user;\n  const ownerMode = isOwner(c.env, current);\n  const boostCost = ownerMode ? 0 : AUTO_MINE_BOOST_COST;\n  if (!ownerMode && current.points < boostCost) return c.json({ error: 'Blue Points کافی نیست' }, 409);\n  const boostUntil = Math.max(now, Number(current.auto_mine_boost_until || 0)) + AUTO_MINE_BOOST_DURATION_MS;\n  const result = await c.env.DB.prepare('UPDATE users SET points = points - ?, auto_mine_boost_until = ?, auto_mine_last_at = ?, auto_mine_confirmed_at = ?, updated_at = ? WHERE id = ? AND points >= ?').bind(boostCost, boostUntil, now, now, now, current.id, boostCost).run();",
)
replace(
    'apps/api/src/index.ts',
    "      .bind(current.id, -AUTO_MINE_BOOST_COST, 'auto_mine_booster', JSON.stringify({ boostUntil }), now).run(),\n    contributeJackpot(c.env, AUTO_MINE_BOOST_COST),",
    "      .bind(current.id, -boostCost, 'auto_mine_booster', JSON.stringify({ boostUntil, ownerMode }), now).run(),\n    contributeJackpot(c.env, boostCost),",
)

replace(
    'apps/api/src/index.ts',
    "  const user = await currentUser(c);\n  if (Number(user.mining_shields || 0) >= MAX_MINING_SHIELDS) return c.json({ error: 'حداکثر Mining Shield را داری' }, 409);\n  if (user.points < MINING_SHIELD_COST) return c.json({ error: 'Blue Points کافی نیست' }, 409);\n  const now = Date.now();\n  const result = await c.env.DB.prepare('UPDATE users SET points = points - ?, mining_shields = mining_shields + 1, updated_at = ? WHERE id = ? AND points >= ? AND mining_shields < ?').bind(MINING_SHIELD_COST, now, user.id, MINING_SHIELD_COST, MAX_MINING_SHIELDS).run();",
    "  const user = await currentUser(c);\n  const ownerMode = isOwner(c.env, user);\n  if (!ownerMode && Number(user.mining_shields || 0) >= MAX_MINING_SHIELDS) return c.json({ error: 'حداکثر Mining Shield را داری' }, 409);\n  const shieldCost = ownerMode ? 0 : MINING_SHIELD_COST;\n  if (!ownerMode && user.points < shieldCost) return c.json({ error: 'Blue Points کافی نیست' }, 409);\n  const now = Date.now();\n  const result = ownerMode\n    ? await c.env.DB.prepare('UPDATE users SET mining_shields = mining_shields + 1, updated_at = ? WHERE id = ?').bind(now, user.id).run()\n    : await c.env.DB.prepare('UPDATE users SET points = points - ?, mining_shields = mining_shields + 1, updated_at = ? WHERE id = ? AND points >= ? AND mining_shields < ?').bind(shieldCost, now, user.id, shieldCost, MAX_MINING_SHIELDS).run();",
)
replace(
    'apps/api/src/index.ts',
    "      .bind(user.id, -MINING_SHIELD_COST, 'mining_shield', JSON.stringify({ quantity: 1 }), now).run(),\n    contributeJackpot(c.env, MINING_SHIELD_COST),",
    "      .bind(user.id, -shieldCost, 'mining_shield', JSON.stringify({ quantity: 1, ownerMode }), now).run(),\n    contributeJackpot(c.env, shieldCost),",
)

replace(
    'apps/api/src/index.ts',
    "  const requirement = PRESTIGE_STEP * (prestigeLevel + 1);\n  if (Number(current.total_earned || 0) < requirement) return c.json({ error: 'برای Prestige هنوز کل استخراج کافی نیست' }, 409);",
    "  const requirement = PRESTIGE_STEP * (prestigeLevel + 1);\n  const ownerMode = isOwner(c.env, current);\n  if (!ownerMode && Number(current.total_earned || 0) < requirement) return c.json({ error: 'برای Prestige هنوز کل استخراج کافی نیست' }, 409);",
)

replace(
    'apps/api/src/index.ts',
    "  const expectedLastChestAt = Number(current.last_chest_at || 0);\n  const state = chestState(expectedLastChestAt, now);\n  if (!state.ready) return c.json({ error: 'صندوق هنوز آماده نیست' }, 409);",
    "  const expectedLastChestAt = Number(current.last_chest_at || 0);\n  const ownerMode = isOwner(c.env, current);\n  const state = ownerMode ? { ready: true } : chestState(expectedLastChestAt, now);\n  if (!state.ready) return c.json({ error: 'صندوق هنوز آماده نیست' }, 409);",
)
replace(
    'apps/api/src/index.ts',
    "  if (reward.type === 'shield' && Number(current.mining_shields || 0) >= MAX_MINING_SHIELDS) {",
    "  if (!ownerMode && reward.type === 'shield' && Number(current.mining_shields || 0) >= MAX_MINING_SHIELDS) {",
)
replace(
    'apps/api/src/index.ts',
    "      WHERE id = ? AND last_chest_at = ? AND mining_shields = ? AND mining_shields < ?\n    `).bind(now, now, current.id, expectedLastChestAt, current.mining_shields, MAX_MINING_SHIELDS).run();",
    "      WHERE id = ? AND last_chest_at = ? AND mining_shields = ?\n    `).bind(now, now, current.id, expectedLastChestAt, current.mining_shields).run();",
)

replace(
    'apps/api/src/index.ts',
    "  let unlocked: string[] = ['blue'];\n  try { unlocked = Array.from(new Set(['blue', ...JSON.parse(user.unlocked_skins || '[]').map(String)])); } catch {}\n  const now = Date.now();\n  if (!unlocked.includes(skin.id)) {\n    if (user.points < skin.cost) return c.json({ error: 'Blue Points کافی نیست' }, 409);",
    "  const ownerMode = isOwner(c.env, user);\n  let unlocked: string[] = ownerMode ? SKINS.map((item) => item.id) : ['blue'];\n  if (!ownerMode) { try { unlocked = Array.from(new Set(['blue', ...JSON.parse(user.unlocked_skins || '[]').map(String)])); } catch {} }\n  const now = Date.now();\n  if (!unlocked.includes(skin.id)) {\n    if (user.points < skin.cost) return c.json({ error: 'Blue Points کافی نیست' }, 409);",
)

replace(
    'apps/api/src/index.ts',
    "  const day = utcDayKey();\n  if (user.last_daily_day === day) return c.json({ error: 'Daily reward already claimed' }, 409);\n  const streak = isYesterday(user.last_daily_day, day) ? Number(user.daily_streak || 0) + 1 : 1;",
    "  const day = utcDayKey();\n  const ownerMode = isOwner(c.env, user);\n  if (!ownerMode && user.last_daily_day === day) return c.json({ error: 'Daily reward already claimed' }, 409);\n  const streak = ownerMode ? Number(user.daily_streak || 0) + 1 : isYesterday(user.last_daily_day, day) ? Number(user.daily_streak || 0) + 1 : 1;",
)
replace(
    'apps/api/src/index.ts',
    "  const updated = await c.env.DB.prepare(`\n    UPDATE users\n    SET points = points + ?, total_earned = total_earned + ?, last_daily_day = ?, daily_streak = ?, updated_at = ?\n    WHERE id = ? AND COALESCE(last_daily_day, '') <> ?\n  `).bind(reward, reward, day, streak, now, user.id, day).run();",
    "  const updated = ownerMode\n    ? await c.env.DB.prepare('UPDATE users SET points = points + ?, total_earned = total_earned + ?, last_daily_day = ?, daily_streak = ?, updated_at = ? WHERE id = ?').bind(reward, reward, day, streak, now, user.id).run()\n    : await c.env.DB.prepare(`\n      UPDATE users\n      SET points = points + ?, total_earned = total_earned + ?, last_daily_day = ?, daily_streak = ?, updated_at = ?\n      WHERE id = ? AND COALESCE(last_daily_day, '') <> ?\n    `).bind(reward, reward, day, streak, now, user.id, day).run();",
)

replace(
    'apps/api/src/index.ts',
    "  const tasks = await taskView(c.env, user);\n  const state = tasks.find((item) => item.id === taskId)!;\n  if (state.claimed) return c.json({ error: 'Task already claimed' }, 409);\n  if (!state.completed) return c.json({ error: 'Task is not completed yet' }, 400);\n  const now = Date.now();\n  const inserted = await c.env.DB.prepare('INSERT OR IGNORE INTO task_claims (user_id, task_id, reward, created_at) VALUES (?, ?, ?, ?)').bind(user.id, task.id, task.reward, now).run();\n  if (!inserted.meta.changes) return c.json({ error: 'Task already claimed' }, 409);",
    "  const ownerMode = isOwner(c.env, user);\n  const tasks = await taskView(c.env, user);\n  const state = tasks.find((item) => item.id === taskId)!;\n  if (!ownerMode && state.claimed) return c.json({ error: 'Task already claimed' }, 409);\n  if (!ownerMode && !state.completed) return c.json({ error: 'Task is not completed yet' }, 400);\n  const now = Date.now();\n  if (!ownerMode) {\n    const inserted = await c.env.DB.prepare('INSERT OR IGNORE INTO task_claims (user_id, task_id, reward, created_at) VALUES (?, ?, ?, ?)').bind(user.id, task.id, task.reward, now).run();\n    if (!inserted.meta.changes) return c.json({ error: 'Task already claimed' }, 409);\n  }",
)
replace(
    'apps/api/src/index.ts',
    "    c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)').bind(user.id, task.reward, 'task', JSON.stringify({ taskId }), now),",
    "    c.env.DB.prepare('INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)').bind(user.id, task.reward, ownerMode ? 'owner_task' : 'task', JSON.stringify({ taskId }), now),",
)

# Front-end type + the only client-side gate that cannot be eliminated by profile projection.
replace(
    'apps/web/src/types.ts',
    'export interface Profile {\n  id: string;',
    'export interface Profile {\n  ownerMode: boolean;\n  id: string;',
)
replace(
    'apps/web/src/App.tsx',
    "<button disabled={busy || turboActive || profile.points < profile.turboCost} onClick={activateTurbo}>{turboActive ? 'توربو فعال است' : `فعال‌سازی · ${nf.format(profile.turboCost)} امتیاز`}</button>",
    "<button disabled={busy || (!profile.ownerMode && turboActive) || profile.points < profile.turboCost} onClick={activateTurbo}>{profile.ownerMode ? 'فعال‌سازی/تمدید رایگان' : turboActive ? 'توربو فعال است' : `فعال‌سازی · ${nf.format(profile.turboCost)} امتیاز`}</button>",
)
replace(
    'apps/web/src/App.tsx',
    "<div className=\"auto-mine-deadline\">{autoMineExpired ? <span>مهلت تأیید تمام شده؛ اگر محافظ نداشته باشی امتیازهای معلق از بین می‌روند.</span> : <span>مهلت تأیید: {durationLabel(autoMineRemainingSeconds)} دیگر</span>}<small>محافظ موجود: {nf.format(profile.miningShields)}</small></div>",
    "<div className=\"auto-mine-deadline\">{profile.ownerMode ? <span>مهلت تأیید: نامحدود (حالت مالک)</span> : autoMineExpired ? <span>مهلت تأیید تمام شده؛ اگر محافظ نداشته باشی امتیازهای معلق از بین می‌روند.</span> : <span>مهلت تأیید: {durationLabel(autoMineRemainingSeconds)} دیگر</span>}<small>محافظ موجود: {nf.format(profile.miningShields)}</small></div>",
)

# Regression coverage for the privileged identity and the fact that auth is still present.
test_path = 'tests/security-regression.test.mjs'
test_text = read(test_path)
if "owner account has explicit unrestricted game mode" not in test_text:
    test_text += f"""

test('owner account has explicit unrestricted game mode without disabling Telegram auth', () => {{
  const owner = read('apps/api/src/owner.ts');
  const wrangler = read('apps/api/wrangler.toml');
  const api = read('apps/api/src/index.ts');
  const db = read('apps/api/src/db.ts');
  assert.match(owner, /{OWNER_ID}/);
  assert.match(wrangler, /OWNER_TELEGRAM_ID = \"{OWNER_ID}\"/);
  assert.match(api, /isOwner\(c\.env, user\)/);
  assert.match(api, /authenticateRequest/);
  assert.match(db, /ownerMode/);
  assert.match(db, /Number\.MAX_SAFE_INTEGER/);
}});
"""
    write(test_path, test_text)

print('Owner unrestricted mode patch applied successfully')
