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
