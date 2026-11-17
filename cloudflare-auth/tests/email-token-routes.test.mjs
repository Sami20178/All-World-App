import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../worker.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const here = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(join(here, "../schema.sql"), "utf8");
const ORIGIN = "https://app.example.test";

class FakeD1 {
  constructor() {
    this.db = new Database(":memory:");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(schemaSql);
  }

  prepare(sql) {
    const owner = this;
    let params = [];
    const statement = {
      bind(...values) { params = values; return statement; },
      async first() { return owner.db.prepare(sql).get(...params) || null; },
      async all() { return { results: owner.db.prepare(sql).all(...params) }; },
      async run() {
        const result = owner.db.prepare(sql).run(...params);
        return { success: true, meta: { changes: result.changes } };
      },
      _run() { return owner.db.prepare(sql).run(...params); }
    };
    return statement;
  }

  async batch(statements) {
    const results = this.db.transaction(() => statements.map(statement => statement._run()))();
    return results.map(result => ({ success: true, meta: { changes: result.changes } }));
  }
}

function fakeMailer(status = 202) {
  const messages = [];
  return {
    messages,
    binding: {
      async fetch(request) {
        messages.push(await request.json());
        return new Response(null, { status });
      }
    }
  };
}

function env(overrides = {}) {
  return {
    AUTH_DB: new FakeD1(),
    APP_ORIGIN: ORIGIN,
    RATE_LIMIT_SECRET: "test-only-rate-limit-secret-with-32-bytes",
    ...overrides
  };
}

function request(path, options = {}) {
  const { ip, ...init } = options;
  const headers = new Headers(init.headers || {});
  if (!headers.has("Origin")) headers.set("Origin", ORIGIN);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  if (!headers.has("CF-Connecting-IP")) headers.set("CF-Connecting-IP", ip || "192.0.2.40");
  return new Request("https://api.example.test" + path, { ...init, headers });
}

function cookieFrom(response) {
  return (response.headers.get("Set-Cookie") || "").split(";")[0];
}

async function body(response) {
  return response.json();
}

function tokenFromMessage(message) {
  const match = String(message.text || "").match(/https:\/\/[^\s]+/);
  assert.ok(match, "mailer message must contain a verification/reset link");
  return new URL(match[0]).searchParams.get("token");
}

async function sha256(value) {
  const bytes = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(bytes).toString("base64url");
}

test("required email verification sends a one-time token and gates login until confirmation", async () => {
  const mailer = fakeMailer();
  const bindings = env({
    REQUIRE_EMAIL_VERIFICATION: "true",
    EMAIL_SENDER: mailer.binding
  });

  const registered = await worker.fetch(request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username: "verify_user",
      email: "verify@example.test",
      password: "A-long-test-password!"
    })
  }), bindings);

  assert.equal(registered.status, 201);
  const registeredBody = await body(registered);
  assert.equal(registeredBody.emailVerificationRequired, true);
  assert.equal(registeredBody.user.emailVerified, false);
  assert.equal(mailer.messages.length, 1);
  assert.equal(mailer.messages[0].type, "verification");

  const token = tokenFromMessage(mailer.messages[0]);
  const tokenRow = bindings.AUTH_DB.db.prepare(
    "SELECT token_hash FROM email_verification_tokens WHERE user_id=(SELECT id FROM users WHERE username_normalized=?)"
  ).get("verify_user");
  assert.equal(tokenRow.token_hash, await sha256(token));
  assert.notEqual(tokenRow.token_hash, token, "only a token hash may be stored");

  const restrictedLogin = await worker.fetch(request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "verify@example.test", password: "A-long-test-password!" }),
    ip: "192.0.2.41"
  }), bindings);
  assert.equal(restrictedLogin.status, 200);
  const restrictedBody = await body(restrictedLogin);
  assert.equal(restrictedBody.user.emailVerified, false);
  assert.equal(restrictedBody.emailVerificationRequired, true);

  const cookie = cookieFrom(restrictedLogin);
  const blockedAccount = await worker.fetch(request("/api/account", {
    headers: { Cookie: cookie }
  }), bindings);
  assert.equal(blockedAccount.status, 403);

  const resent = await worker.fetch(request("/api/auth/email-verification/request", {
    method: "POST",
    headers: { Cookie: cookie },
    ip: "192.0.2.42"
  }), bindings);
  assert.equal(resent.status, 202);
  assert.equal(mailer.messages[1].type, "verification");
  const resentToken = tokenFromMessage(mailer.messages[1]);

  const firstTokenReplay = await worker.fetch(request("/api/auth/email-verification/confirm", {
    method: "POST",
    body: JSON.stringify({ token }),
    ip: "192.0.2.43"
  }), bindings);
  assert.equal(firstTokenReplay.status, 400, "resending must invalidate the previous token");

  const confirmed = await worker.fetch(request("/api/auth/email-verification/confirm", {
    method: "POST",
    body: JSON.stringify({ token: resentToken }),
    ip: "192.0.2.44"
  }), bindings);
  assert.equal(confirmed.status, 200);
  assert.deepEqual(await body(confirmed), { ok: true, verified: true });

  const user = bindings.AUTH_DB.db.prepare(
    "SELECT email_verified_at FROM users WHERE username_normalized=?"
  ).get("verify_user");
  assert.ok(user.email_verified_at);

  const account = await worker.fetch(request("/api/account", {
    headers: { Cookie: cookie }
  }), bindings);
  assert.equal(account.status, 200);

  const replay = await worker.fetch(request("/api/auth/email-verification/confirm", {
    method: "POST",
    body: JSON.stringify({ token }),
    ip: "192.0.2.43"
  }), bindings);
  assert.equal(replay.status, 400);
});

test("password reset is enumeration-resistant, single-use, and revokes existing sessions", async () => {
  const mailer = fakeMailer();
  const bindings = env({ EMAIL_SENDER: mailer.binding });

  const registered = await worker.fetch(request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username: "reset_user",
      email: "reset@example.test",
      password: "Old-test-password!"
    })
  }), bindings);
  assert.equal(registered.status, 201);
  const sessionCookie = cookieFrom(registered);

  const known = await worker.fetch(request("/api/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email: "reset@example.test" }),
    ip: "192.0.2.50"
  }), bindings);
  assert.equal(known.status, 202);
  const knownBody = await body(known);
  assert.equal(knownBody.message, "Falls ein Konto existiert, wurde eine Nachricht gesendet.");
  assert.equal(mailer.messages[0].type, "password-reset");

  const token = tokenFromMessage(mailer.messages[0]);
  const tokenRow = bindings.AUTH_DB.db.prepare(
    "SELECT token_hash FROM password_reset_tokens WHERE user_id=(SELECT id FROM users WHERE username_normalized=?)"
  ).get("reset_user");
  assert.equal(tokenRow.token_hash, await sha256(token));
  assert.notEqual(tokenRow.token_hash, token, "only a token hash may be stored");

  const unknown = await worker.fetch(request("/api/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email: "unknown@example.test" }),
    ip: "192.0.2.51"
  }), bindings);
  assert.equal(unknown.status, 202);
  assert.equal((await body(unknown)).message, knownBody.message);
  assert.deepEqual(mailer.messages[1], { version: 1, action: "suppress" });
  assert.equal("to" in mailer.messages[1], false);

  const reset = await worker.fetch(request("/api/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ token, password: "New-test-password!" }),
    ip: "192.0.2.52"
  }), bindings);
  assert.equal(reset.status, 200);

  const oldSession = await worker.fetch(request("/api/account", {
    headers: { Cookie: sessionCookie }
  }), bindings);
  assert.equal(oldSession.status, 401, "password reset must revoke every existing session");

  const oldLogin = await worker.fetch(request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "reset@example.test", password: "Old-test-password!" }),
    ip: "192.0.2.53"
  }), bindings);
  assert.equal(oldLogin.status, 401);

  const newLogin = await worker.fetch(request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "reset@example.test", password: "New-test-password!" }),
    ip: "192.0.2.54"
  }), bindings);
  assert.equal(newLogin.status, 200);

  const replay = await worker.fetch(request("/api/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ token, password: "Another-test-password!" }),
    ip: "192.0.2.55"
  }), bindings);
  assert.equal(replay.status, 400);
});

test("email verification and reset fail closed without the private mailer binding", async () => {
  const bindings = env();
  const registered = await worker.fetch(request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username: "no_mailer_user",
      email: "nomailer@example.test",
      password: "A-long-test-password!"
    })
  }), bindings);
  assert.equal(registered.status, 201);

  const verification = await worker.fetch(request("/api/auth/email-verification/request", {
    method: "POST",
    headers: { Cookie: cookieFrom(registered) }
  }), bindings);
  assert.equal(verification.status, 503);

  const reset = await worker.fetch(request("/api/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email: "nomailer@example.test" })
  }), bindings);
  assert.equal(reset.status, 503);

  const malformed = await worker.fetch(request("/api/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ token: "not-a-token", password: "A-new-test-password!" })
  }), bindings);
  assert.equal(malformed.status, 400);
});

test("required verification refuses registration when the mailer is missing without storing an account", async () => {
  const bindings = env({ REQUIRE_EMAIL_VERIFICATION: "true" });
  const response = await worker.fetch(request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username: "blocked_user",
      email: "blocked@example.test",
      password: "A-long-test-password!"
    })
  }), bindings);
  assert.equal(response.status, 503);
  assert.equal(bindings.AUTH_DB.db.prepare("SELECT COUNT(*) AS count FROM users").get().count, 0);
});
