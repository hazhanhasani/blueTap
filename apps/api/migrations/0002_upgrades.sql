ALTER TABLE users ADD COLUMN total_earned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN tap_power_level INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN turbo_until INTEGER NOT NULL DEFAULT 0;

UPDATE users
SET total_earned = points
WHERE total_earned = 0 AND points > 0;

CREATE INDEX IF NOT EXISTS idx_users_total_earned ON users(total_earned DESC);
