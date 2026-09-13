CREATE TABLE IF NOT EXISTS pending_referrals (
  telegram_id TEXT PRIMARY KEY,
  referral_code TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_pending_referrals_code
  ON pending_referrals(referral_code, consumed_at);

-- If the invited account already exists but is still new and unassigned,
-- capture the referral immediately when Telegram sends /start ref_... .
CREATE TRIGGER IF NOT EXISTS trg_pending_referral_existing_user
AFTER INSERT ON pending_referrals
WHEN EXISTS (
  SELECT 1
  FROM users AS invitee
  JOIN users AS inviter ON inviter.referral_code = NEW.referral_code
  WHERE invitee.telegram_id = NEW.telegram_id
    AND invitee.referred_by IS NULL
    AND inviter.id <> invitee.id
    AND NEW.created_at >= invitee.created_at
    AND NEW.created_at - invitee.created_at <= 86400000
)
BEGIN
  UPDATE users
  SET referred_by = (SELECT id FROM users WHERE referral_code = NEW.referral_code LIMIT 1),
      points = points + 100,
      total_earned = total_earned + 100,
      updated_at = NEW.created_at
  WHERE telegram_id = NEW.telegram_id
    AND referred_by IS NULL;

  UPDATE users
  SET points = points + 500,
      total_earned = total_earned + 500,
      updated_at = NEW.created_at
  WHERE id = (SELECT referred_by FROM users WHERE telegram_id = NEW.telegram_id);

  INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at)
  SELECT id, 100, 'referral_join', '{"source":"telegram_start"}', NEW.created_at
  FROM users WHERE telegram_id = NEW.telegram_id;

  INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at)
  SELECT referred_by, 500, 'referral_invite', '{"source":"telegram_start"}', NEW.created_at
  FROM users WHERE telegram_id = NEW.telegram_id AND referred_by IS NOT NULL;

  UPDATE pending_referrals
  SET consumed_at = NEW.created_at
  WHERE telegram_id = NEW.telegram_id;
END;

-- If /start arrived before the player ever opened BlueTap, consume the
-- saved referral atomically when their user row is first created.
CREATE TRIGGER IF NOT EXISTS trg_pending_referral_new_user
AFTER INSERT ON users
WHEN EXISTS (
  SELECT 1
  FROM pending_referrals AS pending
  JOIN users AS inviter ON inviter.referral_code = pending.referral_code
  WHERE pending.telegram_id = NEW.telegram_id
    AND pending.consumed_at IS NULL
    AND inviter.id <> NEW.id
)
BEGIN
  UPDATE users
  SET referred_by = (
        SELECT inviter.id
        FROM pending_referrals AS pending
        JOIN users AS inviter ON inviter.referral_code = pending.referral_code
        WHERE pending.telegram_id = NEW.telegram_id
          AND pending.consumed_at IS NULL
        LIMIT 1
      ),
      points = points + 100,
      total_earned = total_earned + 100,
      updated_at = NEW.updated_at
  WHERE id = NEW.id
    AND referred_by IS NULL;

  UPDATE users
  SET points = points + 500,
      total_earned = total_earned + 500,
      updated_at = NEW.updated_at
  WHERE id = (SELECT referred_by FROM users WHERE id = NEW.id);

  INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at)
  SELECT NEW.id, 100, 'referral_join', '{"source":"telegram_pending"}', NEW.updated_at
  WHERE (SELECT referred_by FROM users WHERE id = NEW.id) IS NOT NULL;

  INSERT INTO point_ledger (user_id, amount, kind, metadata, created_at)
  SELECT referred_by, 500, 'referral_invite', '{"source":"telegram_pending"}', NEW.updated_at
  FROM users WHERE id = NEW.id AND referred_by IS NOT NULL;

  UPDATE pending_referrals
  SET consumed_at = NEW.updated_at
  WHERE telegram_id = NEW.telegram_id
    AND consumed_at IS NULL;
END;
