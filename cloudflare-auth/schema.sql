CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL UNIQUE,
  email TEXT,
  email_normalized TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_idx
  ON users(email_normalized) WHERE email_normalized IS NOT NULL;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS account_links (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  linked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, linked_user_id),
  CHECK(user_id <> linked_user_id)
);
CREATE TABLE IF NOT EXISTS user_data (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS user_data_user_idx ON user_data(user_id, updated_at);
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_identities (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS oauth_identities_user_idx ON oauth_identities(user_id);
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  code_verifier TEXT,
  user_id TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_states_expiry_idx ON oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS oauth_nonces (
  state_hash TEXT PRIMARY KEY,
  nonce_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_nonces_expiry_idx ON oauth_nonces(expires_at);

-- Worldmessanger: invitations, accepted conversations, messages and call signalling.
CREATE TABLE IF NOT EXISTS messenger_invitations (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
  conversation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(sender_id <> receiver_id)
);
CREATE INDEX IF NOT EXISTS messenger_invitations_receiver_idx ON messenger_invitations(receiver_id,status,created_at);
CREATE INDEX IF NOT EXISTS messenger_invitations_sender_idx ON messenger_invitations(sender_id,status,created_at);
CREATE TABLE IF NOT EXISTS messenger_conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'direct' CHECK(kind IN ('direct','group')),
  dm_key TEXT UNIQUE,
  title TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messenger_participants (
  conversation_id TEXT NOT NULL REFERENCES messenger_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  last_read_at TEXT,
  PRIMARY KEY(conversation_id,user_id)
);
CREATE INDEX IF NOT EXISTS messenger_participants_user_idx ON messenger_participants(user_id,conversation_id);
CREATE TABLE IF NOT EXISTS messenger_group_settings (
  conversation_id TEXT PRIMARY KEY REFERENCES messenger_conversations(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL CHECK(visibility IN ('private','public')),
  pin_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  min_rank TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messenger_group_requests (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES messenger_conversations(id) ON DELETE CASCADE,
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(conversation_id,requester_id)
);
CREATE INDEX IF NOT EXISTS messenger_group_requests_conversation_idx ON messenger_group_requests(conversation_id,status,created_at);
CREATE INDEX IF NOT EXISTS messenger_group_requests_requester_idx ON messenger_group_requests(requester_id,status,created_at);
CREATE TABLE IF NOT EXISTS messenger_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES messenger_conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  edited_at TEXT
);
CREATE INDEX IF NOT EXISTS messenger_messages_conversation_idx ON messenger_messages(conversation_id,created_at);
CREATE TABLE IF NOT EXISTS messenger_calls (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES messenger_conversations(id) ON DELETE CASCADE,
  caller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK(media_type IN ('audio','video')),
  status TEXT NOT NULL CHECK(status IN ('ringing','accepted','declined','ended','missed')),
  offer_sdp TEXT NOT NULL,
  answer_sdp TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS messenger_calls_callee_idx ON messenger_calls(callee_id,status,created_at);
CREATE TABLE IF NOT EXISTS messenger_call_ice (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL REFERENCES messenger_calls(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
