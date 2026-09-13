PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT NOT NULL DEFAULT '',
  points INTEGER NOT NULL DEFAULT 0,
  taps INTEGER NOT NULL DEFAULT 0,
  energy INTEGER NOT NULL DEFAULT 1000,
  max_energy INTEGER NOT NULL DEFAULT 1000,
  last_energy_at INTEGER NOT NULL,
  tap_bucket REAL NOT NULL DEFAULT 20,
  tap_bucket_at INTEGER NOT NULL,
  referral_code TEXT NOT NULL UNIQUE,
  referred_by INTEGER,
  wallet_address TEXT,
  last_daily_day TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (referred_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_users_points ON users(points DESC);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);

CREATE TABLE IF NOT EXISTS point_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_point_ledger_user ON point_ledger(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  reward INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, task_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
