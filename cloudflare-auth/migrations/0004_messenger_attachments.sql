CREATE TABLE IF NOT EXISTS messenger_attachments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES messenger_conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messenger_messages(id) ON DELETE CASCADE,
  uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messenger_attachments_conversation_idx ON messenger_attachments(conversation_id,created_at);
CREATE TABLE IF NOT EXISTS messenger_attachment_chunks (
  attachment_id TEXT NOT NULL REFERENCES messenger_attachments(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_data BLOB NOT NULL,
  PRIMARY KEY(attachment_id,chunk_index)
);