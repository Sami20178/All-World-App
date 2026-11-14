-- Additive migration 0002.
-- Stores only SHA-256 token hashes. Raw verification/reset tokens must never be persisted.
ALTER TABLE users ADD COLUMN email_verified_at TEXT;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS email_verification_tokens_expiry_idx
  ON email_verification_tokens(expires_at);
CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx
  ON email_verification_tokens(user_id, email_normalized);
CREATE UNIQUE INDEX IF NOT EXISTS email_verification_tokens_one_active_idx
  ON email_verification_tokens(user_id, email_normalized)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx
  ON password_reset_tokens(expires_at);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
  ON password_reset_tokens(user_id, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_one_active_idx
  ON password_reset_tokens(user_id)
  WHERE consumed_at IS NULL;
