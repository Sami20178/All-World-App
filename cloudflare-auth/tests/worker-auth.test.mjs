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
function env(overrides = {}) { return { AUTH_DB: new FakeD1(), APP_ORIGIN: ORIGIN, RATE_LIMIT_SECRET: "test-only-rate-limit-secret-32-bytes", ...overrides }; }
function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Origin")) headers.set("Origin", ORIGIN);
  if (!headers.has("Content-Type") && options.body) headers.set("Content-Type", "application/json");
  if (!headers.has("CF-Connecting-IP")) headers.set("CF-Connecting-IP", "192.0.2.10");
  return new Request("https://api.example.test" + path, { ...options, headers });
}

function cookiesFrom(response) {
  if (typeof response.headers.getSetCookie === "function") return response.headers.getSetCookie();
  const value = response.headers.get("Set-Cookie") || "";
  return value ? value.split(/, (?=[^;,]+=)/g) : [];
}
function namedCookieFrom(response, name) {
  const value = cookiesFrom(response).find(cookie => cookie.startsWith(name + "="));
  return value ? value.split(";")[0] : "";
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
    headers: { Cookie: firstCookie, "CF-Connecting-IP": "192.0.2.17" },
    body: JSON.stringify({ username: email, password })
  }), bindings);
  assert.equal(login.status, 200, "email login must work");
  const loginCookie = cookieFrom(login);
  assert.match(loginCookie, /^allworld\.sid=/);
  const oldSession = await worker.fetch(request("/api/auth/me", { headers: { Cookie: firstCookie } }), bindings);
  assert.equal((await body(oldSession)).user, null, "login must revoke the previous session token");

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

  const secondEmail = "second@example.test";
  const secondPassword = "Another-long-test-password!";
  const secondRegistered = await worker.fetch(request("/api/auth/register", {
    method: "POST",
    headers: { "CF-Connecting-IP": "192.0.2.18" },
    body: JSON.stringify({ username: "second_user", email: secondEmail, password: secondPassword })
  }), bindings);
  assert.equal(secondRegistered.status, 201);
  const secondUser = (await body(secondRegistered)).user;

  const linked = await worker.fetch(request("/api/auth/link", {
    method: "POST",
    headers: { Cookie: loginCookie, "CF-Connecting-IP": "192.0.2.19" },
    body: JSON.stringify({ username: "second_user", password: secondPassword })
  }), bindings);
  assert.equal(linked.status, 201);
  const linkedAccounts = await worker.fetch(request("/api/auth/linked", { headers: { Cookie: loginCookie } }), bindings);
  assert.equal((await body(linkedAccounts)).accounts.length, 2);

  const switched = await worker.fetch(request("/api/auth/switch", {
    method: "POST",
    headers: { Cookie: loginCookie },
    body: JSON.stringify({ accountId: secondUser.id })
  }), bindings);
  assert.equal(switched.status, 200);
  const switchedCookie = cookieFrom(switched);
  assert.equal((await body(await worker.fetch(request("/api/auth/me", { headers: { Cookie: switchedCookie } }), bindings))).user.username, "second_user");

  const deleted = await worker.fetch(request("/api/account", {
    method: "DELETE",
    headers: { Cookie: switchedCookie },
    body: JSON.stringify({ password: secondPassword })
  }), bindings);
  assert.equal(deleted.status, 200);
  assert.equal((await body(deleted)).deleted, true);
  const deletedAccountLogin = await worker.fetch(request("/api/auth/login", {
    method: "POST",
    headers: { "CF-Connecting-IP": "192.0.2.21" },
    body: JSON.stringify({ username: secondEmail, password: secondPassword })
  }), bindings);
  assert.equal(deletedAccountLogin.status, 401, "deleted accounts must no longer be able to log in");

  const freshFirstLogin = await worker.fetch(request("/api/auth/login", {
    method: "POST",
    headers: { "CF-Connecting-IP": "192.0.2.22" },
    body: JSON.stringify({ username: "sample_user", password })
  }), bindings);
  assert.equal(freshFirstLogin.status, 200);
  const freshFirstCookie = cookieFrom(freshFirstLogin);
  const logout = await worker.fetch(request("/api/auth/logout", {
    method: "POST",
    headers: { Cookie: freshFirstCookie }
  }), bindings);
  assert.equal(logout.status, 200);
  const afterLogout = await worker.fetch(request("/api/auth/me", { headers: { Cookie: freshFirstCookie } }), bindings);
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


test("OAuth providers are enabled only from valid server-side config and use a one-time, browser-bound PKCE flow", async () => {
  const tokenUrl = "https://identity.example.test/token";
  const userInfoUrl = "https://identity.example.test/userinfo";
  const authorizeUrl = "https://identity.example.test/authorize";
  const config = {
    demo: {
      label: "Demo Identity",
      clientId: "demo-client",
      clientSecret: "test-only-secret",
      authorizeUrl,
      tokenUrl,
      userInfoUrl,
      scopes: "profile email",
      idField: "sub",
      nameField: "name",
      emailVerifiedField: "email_verified",
      pkce: true
    },
    supercell: {
      label: "Do not expose",
      clientId: "ignored",
      clientSecret: "ignored",
      authorizeUrl,
      tokenUrl,
      userInfoUrl
    },
    insecure: {
      clientId: "ignored",
      clientSecret: "ignored",
      authorizeUrl: "http://identity.example.test/authorize",
      tokenUrl,
      userInfoUrl
    }
  };
  const bindings = env({
    API_PUBLIC_URL: "https://api.example.test",
    OAUTH_PROVIDERS_JSON: JSON.stringify(config)
  });
  const providerResponse = await worker.fetch(request("/api/auth/providers"), bindings);
  const providerData = await body(providerResponse);
  assert.deepEqual(providerData.providers, [{ id: "demo", label: "Demo Identity", enabled: true }]);
  assert.equal(providerData.oauthAvailable, true);
  assert.equal(JSON.stringify(providerData).includes("test-only-secret"), false);

  const start = await worker.fetch(request("/api/auth/oauth/demo"), bindings);
  assert.equal(start.status, 302);
  const authorize = new URL(start.headers.get("Location"));
  assert.equal(authorize.origin + authorize.pathname, authorizeUrl);
  assert.equal(authorize.searchParams.get("client_id"), "demo-client");
  assert.equal(authorize.searchParams.get("redirect_uri"), "https://api.example.test/api/auth/oauth/demo/callback");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorize.searchParams.get("code_challenge"));
  const state = authorize.searchParams.get("state");
  const stateCookie = cookieFrom(start);
  assert.match(stateCookie, /^allworld\.oauth\.demo=/);
  assert.equal(stateCookie.split("=")[1], state);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const target = String(input);
    if (target === tokenUrl) {
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "error");
      const form = new URLSearchParams(init.body);
      assert.equal(form.get("client_id"), "demo-client");
      assert.equal(form.get("client_secret"), "test-only-secret");
      assert.ok(form.get("code_verifier"), "PKCE verifier must be sent only to the token endpoint");
      assert.equal(form.get("code"), "test-code");
      return new Response(JSON.stringify({ access_token: "test-access-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (target === userInfoUrl) {
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), "Bearer test-access-token");
      assert.equal(init.redirect, "error");
      return new Response(JSON.stringify({
        sub: "provider-user-42",
        name: "Demo Person",
        email: "verified@example.test",
        email_verified: true
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    throw new Error("Unexpected test fetch URL");
  };

  try {
    const mismatchedCookie = await worker.fetch(request(
      "/api/auth/oauth/demo/callback?code=test-code&state=" + encodeURIComponent(state),
      { headers: { Cookie: "allworld.oauth.demo=not-the-state" } }
    ), bindings);
    assert.equal(mismatchedCookie.status, 302);
    assert.equal(new URL(mismatchedCookie.headers.get("Location")).searchParams.get("oauth_error"), "invalid_state");

    const callback = await worker.fetch(request(
      "/api/auth/oauth/demo/callback?code=test-code&state=" + encodeURIComponent(state),
      { headers: { Cookie: stateCookie } }
    ), bindings);
    assert.equal(callback.status, 302);
    const callbackLocation = new URL(callback.headers.get("Location"));
    assert.equal(callbackLocation.searchParams.get("oauth"), "success");
    assert.equal(callbackLocation.searchParams.get("provider"), "demo");
    const cookies = cookiesFrom(callback);
    const sessionCookie = namedCookieFrom(callback, "allworld.sid");
    assert.ok(sessionCookie, "successful OAuth login must create a session cookie");
    assert.ok(cookies.some(cookie => cookie.startsWith("allworld.oauth.demo=") && cookie.includes("Max-Age=0")));

    const me = await worker.fetch(request("/api/auth/me", { headers: { Cookie: sessionCookie } }), bindings);
    const meData = await body(me);
    assert.equal(meData.user.username.startsWith("demo_demo_person_"), true);
    assert.equal(meData.user.email, "verified@example.test");
    const identity = bindings.AUTH_DB.db.prepare(
      "SELECT user_id, display_name FROM oauth_identities WHERE provider=? AND provider_user_id=?"
    ).get("demo", "provider-user-42");
    assert.ok(identity);
    assert.equal(identity.display_name, "Demo Person");

    const replay = await worker.fetch(request(
      "/api/auth/oauth/demo/callback?code=test-code&state=" + encodeURIComponent(state),
      { headers: { Cookie: stateCookie } }
    ), bindings);
    assert.equal(new URL(replay.headers.get("Location")).searchParams.get("oauth_error"), "invalid_state");
    assert.equal(bindings.AUTH_DB.db.prepare("SELECT COUNT(*) AS count FROM users").get().count, 1);

    const unconfigured = await worker.fetch(request("/api/auth/oauth/not-configured"), bindings);
    assert.equal(unconfigured.status, 302);
    assert.equal(new URL(unconfigured.headers.get("Location")).searchParams.get("oauth_error"), "provider_not_configured");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
