import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { webcrypto } from "node:crypto";
import worker from "../worker.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class FakeD1 {
  constructor() {
    this.db = new Database(":memory:");
    this.db.pragma("foreign_keys = ON");
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
      }
    };
    return statement;
  }
}

const ORIGIN = "https://app.example.test";
function env() { return { AUTH_DB: new FakeD1(), APP_ORIGIN: ORIGIN }; }
function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Origin")) headers.set("Origin", ORIGIN);
  if (!headers.has("Content-Type") && options.body) headers.set("Content-Type", "application/json");
  if (!headers.has("CF-Connecting-IP")) headers.set("CF-Connecting-IP", "192.0.2.10");
  return new Request("https://api.example.test" + path, { ...options, headers });
}
function cookieFrom(response) {
  return (response.headers.get("Set-Cookie") || "").split(";")[0];
}
async function body(response) { return response.json(); }

test("Cloudflare auth Worker validates origin, stores hashed passwords, and supports sessions and account data", async () => {
  const bindings = env();

  const rejected = await worker.fetch(request("/api/auth/register", {
    method: "POST",
    headers: { Origin: "https://untrusted.example", "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.11" },
    body: JSON.stringify({ username: "intruder", password: "A-long-test-password!" })
  }), bindings);
  assert.equal(rejected.status, 403, "cross-origin mutation must be rejected");

  const invalidEmail = await worker.fetch(request("/api/auth/register", {
    method: "POST",
    headers: { "CF-Connecting-IP": "192.0.2.12" },
    body: JSON.stringify({ username: "sample_user", email: "not-an-email", password: "A-long-test-password!" })
  }), bindings);
  assert.equal(invalidEmail.status, 400, "invalid email must be rejected");

  const email = "sample@example.test";
  const password = "A-long-test-password!";
  const registered = await worker.fetch(request("/api/auth/register", {
    method: "POST",
    headers: { "CF-Connecting-IP": "192.0.2.13" },
    body: JSON.stringify({ username: "sample_user", email, password })
  }), bindings);
  assert.equal(registered.status, 201);
  const firstCookie = cookieFrom(registered);
  assert.match(firstCookie, /^allworld\.sid=/);
  const registeredBody = await body(registered);
  assert.equal(registeredBody.user.email, email);
  assert.equal("password_hash" in registeredBody.user, false);
  assert.equal(registered.headers.get("Access-Control-Allow-Credentials"), "true");
  assert.equal(registered.headers.get("Access-Control-Allow-Origin"), ORIGIN);

  const duplicateUsername = await worker.fetch(request("/api/auth/register", {
    method: "POST",
    headers: { "CF-Connecting-IP": "192.0.2.14" },
    body: JSON.stringify({ username: "SAMPLE_USER", password })
  }), bindings);
  assert.equal(duplicateUsername.status, 409, "username uniqueness must be case-insensitive");

  const duplicateEmail = await worker.fetch(request("/api/auth/register", {
    method: "POST",
    headers: { "CF-Connecting-IP": "192.0.2.15" },
    body: JSON.stringify({ username: "another_user", email: email.toUpperCase(), password })
  }), bindings);
  assert.equal(duplicateEmail.status, 409, "email uniqueness must be case-insensitive");

  const stored = bindings.AUTH_DB.db.prepare("SELECT password_hash FROM users WHERE username_normalized=?").get("sample_user");
  assert.notEqual(stored.password_hash, password, "password must not be stored in plaintext");
  assert.match(stored.password_hash, /^pbkdf2\$310000\$/);

  const me = await worker.fetch(request("/api/auth/me", { headers: { Cookie: firstCookie } }), bindings);
  assert.equal(me.status, 200);
  assert.equal((await body(me)).user.username, "sample_user");

  const badLogin = await worker.fetch(request("/api/auth/login", {
    method: "POST",
    headers: { "CF-Connecting-IP": "192.0.2.16" },
    body: JSON.stringify({ username: email, password: "wrong-password" })
  }), bindings);
  assert.equal(badLogin.status, 401);

  const login = await worker.fetch(request("/api/auth/login", {
    method: "POST",
    headers: { "CF-Connecting-IP": "192.0.2.17" },
    body: JSON.stringify({ username: email, password })
  }), bindings);
  assert.equal(login.status, 200, "email login must work");
  const loginCookie = cookieFrom(login);
  assert.match(loginCookie, /^allworld\.sid=/);

  const saved = await worker.fetch(request("/api/account/data", {
    method: "POST",
    headers: { Cookie: loginCookie, "CF-Connecting-IP": "192.0.2.17" },
    body: JSON.stringify({ type: "preferences", data: { theme: "dark", language: "de" } })
  }), bindings);
  assert.equal(saved.status, 201);
  const savedItem = (await body(saved)).item;
  assert.equal(savedItem.type, "preferences");

  const listed = await worker.fetch(request("/api/account/data", { headers: { Cookie: loginCookie } }), bindings);
  assert.equal((await body(listed)).items.length, 1);

  const updated = await worker.fetch(request("/api/account/data/" + encodeURIComponent(savedItem.id), {
    method: "PUT",
    headers: { Cookie: loginCookie },
    body: JSON.stringify({ type: "preferences", data: { theme: "black" } })
  }), bindings);
  assert.equal(updated.status, 200);
  assert.equal((await body(updated)).item.data.theme, "black");

  const removed = await worker.fetch(request("/api/account/data/" + encodeURIComponent(savedItem.id), {
    method: "DELETE",
    headers: { Cookie: loginCookie }
  }), bindings);
  assert.equal(removed.status, 200);
  assert.equal((await body(await worker.fetch(request("/api/account/data", { headers: { Cookie: loginCookie } }), bindings))).items.length, 0);

  const logout = await worker.fetch(request("/api/auth/logout", {
    method: "POST",
    headers: { Cookie: loginCookie }
  }), bindings);
  assert.equal(logout.status, 200);
  const afterLogout = await worker.fetch(request("/api/auth/me", { headers: { Cookie: cookieFrom(logout) } }), bindings);
  assert.equal((await body(afterLogout)).user, null);

  const providers = await worker.fetch(request("/api/auth/providers"), bindings);
  assert.deepEqual((await body(providers)).providers, [], "unconfigured OAuth providers must not be advertised as active");
});

test("registration endpoint enforces a persistent attempt limit", async () => {
  const bindings = env();
  let last;
  for (let i = 0; i < 6; i++) {
    last = await worker.fetch(request("/api/auth/register", {
      method: "POST",
      headers: { "CF-Connecting-IP": "192.0.2.200" },
      body: JSON.stringify({ username: "x", password: "invalid" })
    }), bindings);
  }
  assert.equal(last.status, 429);
  assert.equal(last.headers.get("Retry-After"), "900");
});
