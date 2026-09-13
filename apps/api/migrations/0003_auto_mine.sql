ALTER TABLE users ADD COLUMN auto_mine_level INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN auto_mine_last_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN auto_mine_confirmed_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN auto_mine_burned INTEGER NOT NULL DEFAULT 0;

UPDATE users
SET auto_mine_last_at = CASE WHEN updated_at > 0 THEN updated_at ELSE created_at END,
    auto_mine_confirmed_at = CASE WHEN updated_at > 0 THEN updated_at ELSE created_at END
WHERE auto_mine_last_at = 0 OR auto_mine_confirmed_at = 0;
