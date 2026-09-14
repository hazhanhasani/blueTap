from pathlib import Path

path = Path('scripts/owner_unlimited.py')
text = path.read_text()

old = '''replace(
    'apps/api/src/index.ts',
    "      .bind(current.id, -AUTO_MINE_BOOST_COST, 'auto_mine_booster', JSON.stringify({ boostUntil }), now).run(),\\n    contributeJackpot(c.env, AUTO_MINE_BOOST_COST),",
    "      .bind(current.id, -boostCost, 'auto_mine_booster', JSON.stringify({ boostUntil, ownerMode }), now).run(),\\n    contributeJackpot(c.env, boostCost),",
)'''
new = '''replace(
    'apps/api/src/index.ts',
    "-AUTO_MINE_BOOST_COST, 'auto_mine_booster', JSON.stringify({ boostUntil }), now).run(),\\n    contributeJackpot(c.env, AUTO_MINE_BOOST_COST),",
    "-boostCost, 'auto_mine_booster', JSON.stringify({ boostUntil, ownerMode }), now).run(),\\n    contributeJackpot(c.env, boostCost),",
)'''
if old not in text:
    raise SystemExit('auto booster matcher block not found')
text = text.replace(old, new, 1)

old = '''replace(
    'apps/api/src/index.ts',
    "      .bind(user.id, -MINING_SHIELD_COST, 'mining_shield', JSON.stringify({ quantity: 1 }), now).run(),\\n    contributeJackpot(c.env, MINING_SHIELD_COST),",
    "      .bind(user.id, -shieldCost, 'mining_shield', JSON.stringify({ quantity: 1, ownerMode }), now).run(),\\n    contributeJackpot(c.env, shieldCost),",
)'''
new = '''replace(
    'apps/api/src/index.ts',
    "-MINING_SHIELD_COST, 'mining_shield', JSON.stringify({ quantity: 1 }), now).run(),\\n    contributeJackpot(c.env, MINING_SHIELD_COST),",
    "-shieldCost, 'mining_shield', JSON.stringify({ quantity: 1, ownerMode }), now).run(),\\n    contributeJackpot(c.env, shieldCost),",
)'''
if old not in text:
    raise SystemExit('mining shield matcher block not found')
text = text.replace(old, new, 1)

old = '''replace(
    'apps/api/src/index.ts',
    "      WHERE id = ? AND last_chest_at = ? AND mining_shields = ? AND mining_shields < ?\\n    `).bind(now, now, current.id, expectedLastChestAt, current.mining_shields, MAX_MINING_SHIELDS).run();",
    "      WHERE id = ? AND last_chest_at = ? AND mining_shields = ?\\n    `).bind(now, now, current.id, expectedLastChestAt, current.mining_shields).run();",
)'''
new = '''replace(
    'apps/api/src/index.ts',
    "  } else if (reward.type === 'shield') {\\n    updated = await c.env.DB.prepare(`\\n      UPDATE users SET mining_shields = mining_shields + 1, last_chest_at = ?, updated_at = ?\\n      WHERE id = ? AND last_chest_at = ? AND mining_shields = ? AND mining_shields < ?\\n    `).bind(now, now, current.id, expectedLastChestAt, current.mining_shields, MAX_MINING_SHIELDS).run();\\n  } else if (reward.type === 'auto_boost') {",
    "  } else if (reward.type === 'shield') {\\n    updated = ownerMode\\n      ? await c.env.DB.prepare(`\\n        UPDATE users SET mining_shields = mining_shields + 1, last_chest_at = ?, updated_at = ?\\n        WHERE id = ? AND last_chest_at = ? AND mining_shields = ?\\n      `).bind(now, now, current.id, expectedLastChestAt, current.mining_shields).run()\\n      : await c.env.DB.prepare(`\\n        UPDATE users SET mining_shields = mining_shields + 1, last_chest_at = ?, updated_at = ?\\n        WHERE id = ? AND last_chest_at = ? AND mining_shields = ? AND mining_shields < ?\\n      `).bind(now, now, current.id, expectedLastChestAt, current.mining_shields, MAX_MINING_SHIELDS).run();\\n  } else if (reward.type === 'auto_boost') {",
)'''
if old not in text:
    raise SystemExit('chest shield matcher block not found')
text = text.replace(old, new, 1)

path.write_text(text)
print('Owner patch matcher repaired')
