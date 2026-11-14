import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, "../migrations");
const initialSql = readFileSync(join(migrations, "0001_initial.sql"), "utf8");
const upgradeSql = readFileSync(join(migrations, "0002_email_verification_and_password_reset.sql"), "utf8");

test("email verification and password reset migration is additive and preserves existing sessions", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  try {
    const legacySql = initialSql.replace(
      /CREATE TABLE IF NOT EXISTS oauth_nonces \([\s\S]*?\);\s*CREATE INDEX IF NOT EXISTS oauth_nonces_expiry_idx ON oauth_nonces\(expires_at\);/,
      ""
    );
    assert.notEqual(legacySql, initialSql, "baseline migration must include the missing oauth_nonces table");
    db.exec(legacySql);
    const now = Date.now();
    db.prepare(`
      INSERT INTO users (
        id, username, username_normalized, email, email_normalized, password_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("user-1", "sample_user", "sample_user", "sample@example.test", "sample@example.test", "pbkdf2$test$hash", new Date(now).toISOString());
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run("session-hash", "user-1", now + 60_000, now);

    db.exec(initialSql); // Apply baseline to an existing database; missing objects are added, existing rows remain.
    db.exec(upgradeSql);

    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    assert.ok(tables.has("oauth_nonces"));
    const columns = db.pragma("table_info(users)").map(column => column.name);
    assert.ok(columns.includes("email_verified_at"));
    assert.equal(columns.includes("email_verification_token"), false);
    assert.equal(columns.includes("password_reset_token"), false);

    const user = db.prepare("SELECT id, email, email_verified_at, password_hash FROM users WHERE id=?").get("user-1");
    assert.equal(user.id, "user-1");
    assert.equal(user.email, "sample@example.test");
    assert.equal(user.email_verified_at, null);
    assert.equal(user.password_hash, "pbkdf2$test$hash");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id=?").get("user-1").count, 1);

    assert.ok(tables.has("email_verification_tokens"));
    assert.ok(tables.has("password_reset_tokens"));

    const emailColumns = db.pragma("table_info(email_verification_tokens)").map(column => column.name);
    const resetColumns = db.pragma("table_info(password_reset_tokens)").map(column => column.name);
    assert.deepEqual(emailColumns, ["token_hash", "user_id", "email_normalized", "expires_at", "created_at", "consumed_at"]);
    assert.deepEqual(resetColumns, ["token_hash", "user_id", "expires_at", "created_at", "consumed_at"]);
    assert.equal(emailColumns.includes("token"), false, "raw verification token must not have a database column");
    assert.equal(resetColumns.includes("token"), false, "raw reset token must not have a database column");

    const emailTokenA = "a".repeat(43);
    const emailTokenB = "b".repeat(43);
    const resetTokenA = "c".repeat(43);
    const resetTokenB = "d".repeat(43);
    const expires = now + 15 * 60_000;

    const insertEmail = db.prepare(`
      INSERT INTO email_verification_tokens
      (token_hash, user_id, email_normalized, expires_at, created_at, consumed_at)
      VALUES (?, ?, ?, ?, ?, NULL)
    `);
    insertEmail.run(emailTokenA, "user-1", "sample@example.test", expires, now);
    assert.throws(
      () => insertEmail.run(emailTokenB, "user-1", "sample@example.test", expires, now),
      /UNIQUE|constraint/i,
      "only one active verification token per user/email should exist"
    );
    db.prepare("UPDATE email_verification_tokens SET consumed_at=? WHERE token_hash=?").run(now, emailTokenA);
    insertEmail.run(emailTokenB, "user-1", "sample@example.test", expires, now);

    const insertReset = db.prepare(`
      INSERT INTO password_reset_tokens
      (token_hash, user_id, expires_at, created_at, consumed_at)
      VALUES (?, ?, ?, ?, NULL)
    `);
    insertReset.run(resetTokenA, "user-1", expires, now);
    assert.throws(
      () => insertReset.run(resetTokenB, "user-1", expires, now),
      /UNIQUE|constraint/i,
      "only one active reset token per user should exist"
    );
    db.prepare("UPDATE password_reset_tokens SET consumed_at=? WHERE token_hash=?").run(now, resetTokenA);
    insertReset.run(resetTokenB, "user-1", expires, now);

    db.prepare("DELETE FROM users WHERE id=?").run("user-1");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sessions").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM email_verification_tokens").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM password_reset_tokens").get().count, 0);
  } finally {
    db.close();
  }
});
