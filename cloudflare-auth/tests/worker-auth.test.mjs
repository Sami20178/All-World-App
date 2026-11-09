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

test("Cloudflare auth Worker denies private account endpoints without a valid session", async () => {
  const bindings = env();
  const protectedRoutes = [
    { method: "GET", path: "/api/auth/linked" },
    { method: "POST", path: "/api/auth/link", body: { username: "someone", password: "not-a-real-password" } },
    { method: "POST", path: "/api/auth/switch", body: { accountId: "not-a-real-account" } },
    { method: "GET", path: "/api/account" },
    { method: "GET", path: "/api/account/data" },
    { method: "POST", path: "/api/account/data", body: { type: "preferences", data: { theme: "dark" } } },
    { method: "PUT", path: "/api/account/data/example-id", body: { type: "preferences", data: { theme: "black" } } },
    { method: "DELETE", path: "/api/account/data/example-id" },
    { method: "DELETE", path: "/api/account", body: { password: "not-a-real-password" } }
  ];

  for (const route of protectedRoutes) {
    const response = await worker.fetch(request(route.path, {
      method: route.method,
      ...(route.body ? { body: JSON.stringify(route.body) } : {})
    }), bindings);
    assert.equal(response.status, 401, `${route.method} ${route.path} must require a valid session`);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
    assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
  }
});

test("Cloudflare auth Worker rejects and removes expired sessions", async () => {
  const bindings = env();
  const registered = await worker.fetch(request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username: "expired_session_user", email: "expired@example.test", password: "A-long-test-password!" })
  }), bindings);
  assert.equal(registered.status, 201);

  const cookie = cookieFrom(registered);
  const token = cookie.slice("allworld.sid=".length);
  const tokenHash = Buffer.from(await webcrypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  )).toString("base64url");
  bindings.AUTH_DB.db.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?").run(Date.now() - 1000, tokenHash);

  const response = await worker.fetch(request("/api/account", { headers: { Cookie: cookie } }), bindings);
  assert.equal(response.status, 401, "expired sessions must not authorize account access");
  assert.equal(
    bindings.AUTH_DB.db.prepare("SELECT token_hash FROM sessions WHERE token_hash=?").get(tokenHash),
    undefined,
    "expired sessions must be removed when accessed"
  );
});

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

  const missingEmail = await worker.fetch(request("/api/auth/register", {
    method: "POST",
    headers: { "CF-Connecting-IP": "192.0.2.120" },
    body: JSON.stringify({ username: "no_email_user", password: "A-long-test-password!" })
  }), bindings);
  assert.equal(missingEmail.status, 400, "registration must require an email address");

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
    body: JSON.stringify({ username: "SAMPLE_USER", email: "another@example.test", password })
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
test("OIDC login validates the ID token signature, issuer, audience, subject and one-time nonce", async () => {
  const authorizeUrl = "https://identity.example.test/authorize";
  const tokenUrl = "https://identity.example.test/token";
  const userInfoUrl = "https://identity.example.test/userinfo";
  const jwksUrl = "https://identity.example.test/jwks";
  const issuer = "https://identity.example.test";
  const keyPair = await webcrypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256"
  }, true, ["sign", "verify"]);
  const publicJwk = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
  publicJwk.kid = "oidc-test-key";
  publicJwk.use = "sig";
  publicJwk.alg = "RS256";

  const makeIdToken = async (claims, signingKey = keyPair.privateKey) => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "oidc-test-key" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signed = header + "." + payload;
    const signature = await webcrypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      signingKey,
      new TextEncoder().encode(signed)
    );
    return signed + "." + Buffer.from(signature).toString("base64url");
  };

  const config = {
    demo: {
      label: "OIDC Demo",
      clientId: "oidc-client",
      clientSecret: "test-only-secret",
      authorizeUrl,
      tokenUrl,
      userInfoUrl,
      jwksUrl,
      oidc: true,
      oidcIssuer: issuer,
      scopes: "openid profile email",
      pkce: true,
      idField: "sub",
      nameField: "name",
      emailVerifiedField: "email_verified"
    }
  };
  const bindings = env({
    API_PUBLIC_URL: "https://api.example.test",
    OAUTH_PROVIDERS_JSON: JSON.stringify(config)
  });

  const invalidConfig = env({
    OAUTH_PROVIDERS_JSON: JSON.stringify({
      demo: { ...config.demo, jwksUrl: "" }
    })
  });
  const invalidProviders = await worker.fetch(request("/api/auth/providers"), invalidConfig);
  assert.deepEqual((await body(invalidProviders)).providers, [], "OIDC config without JWKS must not be exposed");
  const invalidPkceConfig = env({
    OAUTH_PROVIDERS_JSON: JSON.stringify({
      demo: { ...config.demo, pkce: false }
    })
  });
  const invalidPkceProviders = await worker.fetch(request("/api/auth/providers"), invalidPkceConfig);
  assert.deepEqual((await body(invalidPkceProviders)).providers, [], "OIDC config without PKCE must not be exposed");

  const start = await worker.fetch(request("/api/auth/oauth/demo"), bindings);
  assert.equal(start.status, 302);
  const authorize = new URL(start.headers.get("Location"));
  const state = authorize.searchParams.get("state");
  const nonce = authorize.searchParams.get("nonce");
  const stateCookie = cookieFrom(start);
  assert.ok(state);
  assert.ok(nonce, "OIDC authorization must include a fresh nonce");
  assert.equal(authorize.searchParams.get("scope"), "openid profile email");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");

  const now = Math.floor(Date.now() / 1000);
  const idToken = await makeIdToken({
    iss: issuer,
    aud: "oidc-client",
    exp: now + 300,
    iat: now,
    sub: "oidc-subject-42",
    nonce
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const target = String(input);
    if (target === tokenUrl) {
      return new Response(JSON.stringify({ access_token: "oidc-access-token", id_token: idToken }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (target === jwksUrl) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (target === userInfoUrl) {
      return new Response(JSON.stringify({
        sub: "oidc-subject-42",
        name: "OIDC Test User",
        email: "oidc@example.test",
        email_verified: true
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    throw new Error("Unexpected OIDC test fetch URL");
  };

  try {
    const callback = await worker.fetch(request(
      "/api/auth/oauth/demo/callback?code=oidc-test-code&state=" + encodeURIComponent(state),
      { headers: { Cookie: stateCookie } }
    ), bindings);
    assert.equal(callback.status, 302);
    const location = new URL(callback.headers.get("Location"));
    assert.equal(location.searchParams.get("oauth"), "success");
    assert.equal(location.searchParams.get("provider"), "demo");
    const sessionCookie = namedCookieFrom(callback, "allworld.sid");
    assert.ok(sessionCookie);

    const me = await worker.fetch(request("/api/auth/me", { headers: { Cookie: sessionCookie } }), bindings);
    const meData = await body(me);
    assert.equal(meData.user.email, "oidc@example.test");
    const identity = bindings.AUTH_DB.db.prepare(
      "SELECT user_id, provider_user_id FROM oauth_identities WHERE provider=?"
    ).get("demo");
    assert.equal(identity.provider_user_id, "oidc-subject-42");
    assert.equal(bindings.AUTH_DB.db.prepare("SELECT COUNT(*) AS count FROM oauth_nonces").get().count, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OIDC login rejects an invalid audience and never creates an account", async () => {
  const authorizeUrl = "https://identity.example.test/authorize";
  const tokenUrl = "https://identity.example.test/token";
  const userInfoUrl = "https://identity.example.test/userinfo";
  const jwksUrl = "https://identity.example.test/jwks";
  const issuer = "https://identity.example.test";
  const keyPair = await webcrypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256"
  }, true, ["sign", "verify"]);
  const publicJwk = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
  publicJwk.kid = "oidc-invalid-aud-key";
  publicJwk.use = "sig";
  publicJwk.alg = "RS256";
  const config = {
    demo: {
      clientId: "expected-client",
      clientSecret: "test-only-secret",
      authorizeUrl,
      tokenUrl,
      userInfoUrl,
      jwksUrl,
      oidc: true,
      oidcIssuer: issuer,
      scopes: "openid profile",
      pkce: true
    }
  };
  const bindings = env({
    API_PUBLIC_URL: "https://api.example.test",
    OAUTH_PROVIDERS_JSON: JSON.stringify(config)
  });
  const start = await worker.fetch(request("/api/auth/oauth/demo"), bindings);
  const authorize = new URL(start.headers.get("Location"));
  const state = authorize.searchParams.get("state");
  const nonce = authorize.searchParams.get("nonce");
  const stateCookie = cookieFrom(start);
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "oidc-invalid-aud-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: issuer,
    aud: "different-client",
    exp: now + 300,
    iat: now,
    sub: "should-not-be-created",
    nonce
  })).toString("base64url");
  const signed = header + "." + payload;
  const signature = await webcrypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    keyPair.privateKey,
    new TextEncoder().encode(signed)
  );
  const badIdToken = signed + "." + Buffer.from(signature).toString("base64url");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const target = String(input);
    if (target === tokenUrl) {
      return new Response(JSON.stringify({ access_token: "oidc-access-token", id_token: badIdToken }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (target === jwksUrl) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (target === userInfoUrl) throw new Error("UserInfo must not be requested for an invalid ID token");
    throw new Error("Unexpected OIDC test fetch URL");
  };

  try {
    const callback = await worker.fetch(request(
      "/api/auth/oauth/demo/callback?code=oidc-test-code&state=" + encodeURIComponent(state),
      { headers: { Cookie: stateCookie } }
    ), bindings);
    assert.equal(callback.status, 302);
    assert.equal(new URL(callback.headers.get("Location")).searchParams.get("oauth_error"), "login_failed");
    assert.equal(bindings.AUTH_DB.db.prepare("SELECT COUNT(*) AS count FROM users").get().count, 0);
    assert.equal(bindings.AUTH_DB.db.prepare("SELECT COUNT(*) AS count FROM oauth_identities").get().count, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("OIDC login rejects an ID token signed by a key outside the provider JWKS", async () => {
  const authorizeUrl = "https://identity.example.test/authorize";
  const tokenUrl = "https://identity.example.test/token";
  const userInfoUrl = "https://identity.example.test/userinfo";
  const jwksUrl = "https://identity.example.test/jwks";
  const issuer = "https://identity.example.test";
  const [trusted, attacker] = await Promise.all([
    webcrypto.subtle.generateKey({
      name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"
    }, true, ["sign", "verify"]),
    webcrypto.subtle.generateKey({
      name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"
    }, true, ["sign", "verify"])
  ]);
  const trustedJwk = await webcrypto.subtle.exportKey("jwk", trusted.publicKey);
  Object.assign(trustedJwk, { kid: "trusted-key", use: "sig", alg: "RS256" });
  const config = {
    demo: {
      clientId: "trusted-client",
      clientSecret: "test-only-secret",
      authorizeUrl,
      tokenUrl,
      userInfoUrl,
      jwksUrl,
      oidc: true,
      oidcIssuer: issuer,
      scopes: "openid profile",
      pkce: true
    }
  };
  const bindings = env({
    API_PUBLIC_URL: "https://api.example.test",
    OAUTH_PROVIDERS_JSON: JSON.stringify(config)
  });
  const start = await worker.fetch(request("/api/auth/oauth/demo"), bindings);
  const authorize = new URL(start.headers.get("Location"));
  const state = authorize.searchParams.get("state");
  const nonce = authorize.searchParams.get("nonce");
  const stateCookie = cookieFrom(start);
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "trusted-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: issuer,
    aud: "trusted-client",
    exp: now + 300,
    iat: now,
    sub: "forged-subject",
    nonce
  })).toString("base64url");
  const signed = header + "." + payload;
  const signature = await webcrypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    attacker.privateKey,
    new TextEncoder().encode(signed)
  );
  const forgedToken = signed + "." + Buffer.from(signature).toString("base64url");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const target = String(input);
    if (target === tokenUrl) {
      return new Response(JSON.stringify({ access_token: "oidc-access-token", id_token: forgedToken }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (target === jwksUrl) {
      return new Response(JSON.stringify({ keys: [trustedJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (target === userInfoUrl) throw new Error("UserInfo must not be requested for an invalid signature");
    throw new Error("Unexpected OIDC test fetch URL");
  };

  try {
    const callback = await worker.fetch(request(
      "/api/auth/oauth/demo/callback?code=oidc-test-code&state=" + encodeURIComponent(state),
      { headers: { Cookie: stateCookie } }
    ), bindings);
    assert.equal(callback.status, 302);
    assert.equal(new URL(callback.headers.get("Location")).searchParams.get("oauth_error"), "login_failed");
    assert.equal(bindings.AUTH_DB.db.prepare("SELECT COUNT(*) AS count FROM users").get().count, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("OIDC ID-token verification supports ES256 with a P-256 JWKS key", async () => {
  const authorizeUrl = "https://ecdsa.example.test/authorize";
  const tokenUrl = "https://ecdsa.example.test/token";
  const userInfoUrl = "https://ecdsa.example.test/userinfo";
  const jwksUrl = "https://ecdsa.example.test/jwks";
  const issuer = "https://ecdsa.example.test";
  const keyPair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicJwk = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
  Object.assign(publicJwk, { kid: "ecdsa-test-key", use: "sig", alg: "ES256" });
  const config = {
    demo: {
      clientId: "ecdsa-client",
      clientSecret: "test-only-secret",
      authorizeUrl,
      tokenUrl,
      userInfoUrl,
      jwksUrl,
      oidc: true,
      oidcIssuer: issuer,
      scopes: "openid profile",
      pkce: true
    }
  };
  const bindings = env({
    API_PUBLIC_URL: "https://api.example.test",
    OAUTH_PROVIDERS_JSON: JSON.stringify(config)
  });
  const start = await worker.fetch(request("/api/auth/oauth/demo"), bindings);
  const authorize = new URL(start.headers.get("Location"));
  const state = authorize.searchParams.get("state");
  const nonce = authorize.searchParams.get("nonce");
  const stateCookie = cookieFrom(start);
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT", kid: "ecdsa-test-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: issuer,
    aud: "ecdsa-client",
    exp: now + 300,
    iat: now,
    sub: "ecdsa-subject-7",
    nonce
  })).toString("base64url");
  const signed = header + "." + payload;
  const signature = await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    new TextEncoder().encode(signed)
  );
  const idToken = signed + "." + Buffer.from(signature).toString("base64url");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const target = String(input);
    if (target === tokenUrl) {
      return new Response(JSON.stringify({ access_token: "ecdsa-access-token", id_token: idToken }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (target === jwksUrl) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (target === userInfoUrl) {
      return new Response(JSON.stringify({ sub: "ecdsa-subject-7", name: "ECDSA User" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    throw new Error("Unexpected ES256 test fetch URL");
  };

  try {
    const callback = await worker.fetch(request(
      "/api/auth/oauth/demo/callback?code=ecdsa-code&state=" + encodeURIComponent(state),
      { headers: { Cookie: stateCookie } }
    ), bindings);
    assert.equal(callback.status, 302);
    assert.equal(new URL(callback.headers.get("Location")).searchParams.get("oauth"), "success");
    assert.equal(bindings.AUTH_DB.db.prepare("SELECT provider_user_id FROM oauth_identities WHERE provider=?").get("demo").provider_user_id, "ecdsa-subject-7");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("OIDC login rejects a signed ID token with the wrong nonce", async () => {
  const authorizeUrl = "https://nonce.example.test/authorize";
  const tokenUrl = "https://nonce.example.test/token";
  const userInfoUrl = "https://nonce.example.test/userinfo";
  const jwksUrl = "https://nonce.example.test/jwks";
  const issuer = "https://nonce.example.test";
  const keyPair = await webcrypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"
  }, true, ["sign", "verify"]);
  const publicJwk = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
  Object.assign(publicJwk, { kid: "nonce-test-key", use: "sig", alg: "RS256" });
  const config = {
    demo: {
      clientId: "nonce-client",
      clientSecret: "test-only-secret",
      authorizeUrl,
      tokenUrl,
      userInfoUrl,
      jwksUrl,
      oidc: true,
      oidcIssuer: issuer,
      scopes: "openid profile",
      pkce: true
    }
  };
  const bindings = env({
    API_PUBLIC_URL: "https://api.example.test",
    OAUTH_PROVIDERS_JSON: JSON.stringify(config)
  });
  const start = await worker.fetch(request("/api/auth/oauth/demo"), bindings);
  const authorize = new URL(start.headers.get("Location"));
  const state = authorize.searchParams.get("state");
  const stateCookie = cookieFrom(start);
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "nonce-test-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: issuer,
    aud: "nonce-client",
    exp: now + 300,
    iat: now,
    sub: "wrong-nonce-subject",
    nonce: "not-the-issued-nonce"
  })).toString("base64url");
  const signed = header + "." + payload;
  const signature = await webcrypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    keyPair.privateKey,
    new TextEncoder().encode(signed)
  );
  const badIdToken = signed + "." + Buffer.from(signature).toString("base64url");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const target = String(input);
    if (target === tokenUrl) {
      return new Response(JSON.stringify({ access_token: "nonce-access-token", id_token: badIdToken }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (target === jwksUrl) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (target === userInfoUrl) throw new Error("UserInfo must not be requested for a nonce mismatch");
    throw new Error("Unexpected nonce test fetch URL");
  };

  try {
    const callback = await worker.fetch(request(
      "/api/auth/oauth/demo/callback?code=nonce-code&state=" + encodeURIComponent(state),
      { headers: { Cookie: stateCookie } }
    ), bindings);
    assert.equal(callback.status, 302);
    assert.equal(new URL(callback.headers.get("Location")).searchParams.get("oauth_error"), "login_failed");
    assert.equal(bindings.AUTH_DB.db.prepare("SELECT COUNT(*) AS count FROM users").get().count, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
