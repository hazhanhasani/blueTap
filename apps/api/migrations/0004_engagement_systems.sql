ALTER TABLE users ADD COLUMN combo_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN combo_last_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN lucky_hits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN daily_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN auto_mine_boost_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN mining_shields INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN prestige_level INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN selected_skin TEXT NOT NULL DEFAULT 'blue';
ALTER TABLE users ADD COLUMN unlocked_skins TEXT NOT NULL DEFAULT '["blue"]';
ALTER TABLE users ADD COLUMN last_chest_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN daily_metric_day TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN daily_taps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN daily_auto_confirms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN daily_turbo_uses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN weekly_metric_week TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN weekly_taps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN weekly_auto_confirms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN weekly_turbo_uses INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS challenge_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  challenge_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  reward INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, challenge_id, period_key),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_challenge_claims_user_period
ON challenge_claims(user_id, period_key);

CREATE TABLE IF NOT EXISTS league_reward_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  week_key TEXT NOT NULL,
  league_id TEXT NOT NULL,
  reward INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, week_key),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS game_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO game_state (key, value) VALUES ('jackpot_pool', '0');
