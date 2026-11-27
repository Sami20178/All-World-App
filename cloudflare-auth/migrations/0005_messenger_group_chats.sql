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
