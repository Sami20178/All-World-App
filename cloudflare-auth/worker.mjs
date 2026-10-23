const COOKIE_NAME = "allworld.sid";
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const RATE_WINDOW = 15 * 60 * 1000;
const PBKDF2_ITERATIONS = 310000;
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DUMMY_HASH = "pbkdf2$310000$YWFhYWFhYWFhYWFhYWFhYQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL, username_normalized TEXT NOT NULL UNIQUE, email TEXT, email_normalized TEXT, password_hash TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_idx ON users(email_normalized) WHERE email_normalized IS NOT NULL",
  "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)",
  "CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at)",
  "CREATE TABLE IF NOT EXISTS account_links (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, linked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY(user_id, linked_user_id), CHECK(user_id <> linked_user_id))",
  "CREATE TABLE IF NOT EXISTS user_data (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS user_data_user_idx ON user_data(user_id, updated_at)",
  "CREATE TABLE IF NOT EXISTS auth_rate_limits (key_hash TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS oauth_identities (provider TEXT NOT NULL, provider_user_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, display_name TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(provider, provider_user_id))",
  "CREATE INDEX IF NOT EXISTS oauth_identities_user_idx ON oauth_identities(user_id)",
  "CREATE TABLE IF NOT EXISTS oauth_states (state_hash TEXT PRIMARY KEY, provider TEXT NOT NULL, code_verifier TEXT, user_id TEXT, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS oauth_states_expiry_idx ON oauth_states(expires_at)"
];
const schemaPromises = new WeakMap();

function getAllowedOrigin(env) {
  try {
    const origin = new URL(String(env.APP_ORIGIN || ""));
    return origin.protocol === "https:" ? origin.origin : "";
  } catch {
    return "";
  }
}

function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = getAllowedOrigin(env);
  return Boolean(origin && allowed && origin === allowed);
}

function responseHeaders(request, env, extra = {}) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin",
    ...extra
  });
  if (originAllowed(request, env)) {
    headers.set("Access-Control-Allow-Origin", getAllowedOrigin(env));
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, X-All-World-Request");
    headers.set("Access-Control-Max-Age", "600");
  }
  return headers;
}

function json(request, env, data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders(request, env, extra)
  });
}

function cookieValue(request, name = COOKIE_NAME) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return "";
}

function sessionCookie(token) {
  return COOKIE_NAME + "=" + token + "; Path=/; Max-Age=" + Math.floor(SESSION_TTL / 1000) + "; HttpOnly; Secure; SameSite=None";
}

function expiredCookie() {
  return COOKIE_NAME + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None";
}

function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256(value) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

async function ensureSchema(db) {
  if (!db || typeof db.prepare !== "function") throw new Error("AUTH_DB binding missing");
  let promise = schemaPromises.get(db);
  if (!promise) {
    promise = (async () => {
      for (const statement of SCHEMA) await db.prepare(statement).run();
    })();
    schemaPromises.set(db, promise);
  }
  try {
    await promise;
  } catch (error) {
    schemaPromises.delete(db);
    throw error;
  }
}

async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 32768) throw new Error("body_too_large");
  const raw = await request.text();
  if (raw.length > 32768) throw new Error("body_too_large");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("invalid_json");
  }
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email || null,
    createdAt: row.created_at
  };
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt,
    iterations: PBKDF2_ITERATIONS,
    hash: "SHA-256"
  }, key, 256);
  return "pbkdf2$" + PBKDF2_ITERATIONS + "$" + b64url(salt) + "$" + b64url(new Uint8Array(bits));
}

function constantTimeEqual(left, right) {
  const a = left instanceof Uint8Array ? left : new Uint8Array(left);
  const b = right instanceof Uint8Array ? right : new Uint8Array(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) difference |= (a[i] || 0) ^ (b[i] || 0);
  return difference === 0;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 600000) return false;
  let salt;
  let expected;
  try {
    salt = fromB64url(parts[2]);
    expected = fromB64url(parts[3]);
  } catch {
    return false;
  }
  if (salt.length < 16 || expected.length !== 32) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt,
    iterations,
    hash: "SHA-256"
  }, key, 256);
  return constantTimeEqual(new Uint8Array(bits), expected);
}

async function createSession(env, userId) {
  const token = randomToken(32);
  const now = Date.now();
  const expires = now + SESSION_TTL;
  await env.AUTH_DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
  await env.AUTH_DB.prepare("INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES(?,?,?,?)")
    .bind(await sha256(token), userId, expires, now).run();
  return token;
}

async function revokeCurrentSession(request, env) {
  const token = cookieValue(request);
  if (token) await env.AUTH_DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
}

async function currentSession(request, env) {
  const token = cookieValue(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.AUTH_DB.prepare(
    "SELECT s.token_hash, s.expires_at, u.id, u.username, u.email, u.email_normalized, u.password_hash, u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?"
  ).bind(tokenHash).first();
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    await env.AUTH_DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(tokenHash).run();
    return null;
  }
  return { user: row, tokenHash };
}

async function rateLimitKey(env, value) {
  const secret = String(env.RATE_LIMIT_SECRET || "");
  if (secret.length < 32) throw new Error("RATE_LIMIT_SECRET missing");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {
    name: "HMAC",
    hash: "SHA-256"
  }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

async function consumeRateLimit(request, env, action, identity, limit) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = await rateLimitKey(env, ip + "|" + action + "|" + String(identity || "").toLowerCase());
  const now = Date.now();
  const cutoff = now - RATE_WINDOW;
  await env.AUTH_DB.prepare(
    "INSERT INTO auth_rate_limits(key_hash, window_start, count) VALUES(?,?,1) " +
    "ON CONFLICT(key_hash) DO UPDATE SET " +
    "count=CASE WHEN auth_rate_limits.window_start <= ? THEN 1 ELSE auth_rate_limits.count + 1 END, " +
    "window_start=CASE WHEN auth_rate_limits.window_start <= ? THEN ? ELSE auth_rate_limits.window_start END"
  ).bind(key, now, cutoff, cutoff, now).run();
  const row = await env.AUTH_DB.prepare("SELECT count FROM auth_rate_limits WHERE key_hash=?").bind(key).first();
  if (Math.random() < 0.01) {
    await env.AUTH_DB.prepare("DELETE FROM auth_rate_limits WHERE window_start < ?").bind(now - 24 * 60 * 60 * 1000).run();
  }
  return Number(row && row.count) <= limit;
}

async function requireSession(request, env) {
  const session = await currentSession(request, env);
  if (!session) return { response: json(request, env, { error: "Bitte melde dich an." }, 401) };
  return { session };
}


const OAUTH_RESERVED_PROVIDERS = new Set(["apple", "supercell"]);
const OAUTH_RESERVED_PARAMS = new Set(["client_id", "client_secret", "redirect_uri", "response_type", "state", "code_challenge", "code_challenge_method", "scope"]);

function secureHttpsUrl(value) {
  try {
    const url = new URL(typeof value === "string" ? value : "");
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function readOAuthField(value, path) {
  if (!value || typeof value !== "object" || typeof path !== "string" || !/^[A-Za-z0-9_.-]{1,120}$/.test(path)) return undefined;
  return path.split(".").reduce((current, part) => current && typeof current === "object" ? current[part] : undefined, value);
}

function parseOAuthProviders(env) {
  const raw = typeof env.OAUTH_PROVIDERS_JSON === "string" ? env.OAUTH_PROVIDERS_JSON : "";
  if (!raw || raw.length > 65536) return {};
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const providers = {};
  for (const [rawSlug, item] of Object.entries(parsed)) {
    const slug = rawSlug.toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(slug) || OAUTH_RESERVED_PROVIDERS.has(slug)) continue;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const clientId = typeof item.clientId === "string" ? item.clientId.trim() : "";
    const clientSecret = typeof item.clientSecret === "string" ? item.clientSecret : "";
    const authorizeUrl = secureHttpsUrl(item.authorizeUrl);
    const tokenUrl = secureHttpsUrl(item.tokenUrl);
    const userInfoUrl = secureHttpsUrl(item.userInfoUrl);
    if (!clientId || clientId.length > 2048 || !clientSecret || clientSecret.length > 8192 ||
        !authorizeUrl || !tokenUrl || !userInfoUrl) continue;
    const scopes = Array.isArray(item.scopes) ? item.scopes.join(" ") : String(item.scopes || "openid profile email");
    if (scopes.length > 500) continue;
    const label = typeof item.label === "string" && item.label.trim().length <= 60 ? item.label.trim() : slug;
    const clientAuthMethod = item.clientAuthMethod === "basic" ? "basic" : "body";
    const extraAuthorizeParams = {};
    if (item.extraAuthorizeParams && typeof item.extraAuthorizeParams === "object" && !Array.isArray(item.extraAuthorizeParams)) {
      for (const [key, value] of Object.entries(item.extraAuthorizeParams).slice(0, 20)) {
        if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key) || OAUTH_RESERVED_PARAMS.has(key.toLowerCase())) continue;
        if (!["string", "number", "boolean"].includes(typeof value)) continue;
        const text = String(value);
        if (text.length <= 200) extraAuthorizeParams[key] = text;
      }
    }
    providers[slug] = {
      clientId,
      clientSecret,
      authorizeUrl,
      tokenUrl,
      userInfoUrl,
      label: label || slug,
      scopes,
      clientAuthMethod,
      pkce: item.pkce === true,
      idField: typeof item.idField === "string" && item.idField.length <= 120 ? item.idField : "id",
      nameField: typeof item.nameField === "string" && item.nameField.length <= 120 ? item.nameField : "name",
      userInfoPath: typeof item.userInfoPath === "string" && item.userInfoPath.length <= 120 ? item.userInfoPath : "",
      emailVerifiedField: typeof item.emailVerifiedField === "string" && item.emailVerifiedField.length <= 120 ? item.emailVerifiedField : "",
      clientIdHeader: typeof item.clientIdHeader === "string" && /^[A-Za-z0-9-]{1,64}$/.test(item.clientIdHeader) &&
        !["authorization", "cookie", "host", "content-length", "content-type"].includes(item.clientIdHeader.toLowerCase()) ? item.clientIdHeader : "",
      extraAuthorizeParams
    };
  }
  return providers;
}

function apiOrigin(request, env) {
  const candidate = String(env.API_PUBLIC_URL || new URL(request.url).origin);
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function oauthStateCookieName(slug) {
  return "allworld.oauth." + slug;
}

function oauthStateCookie(slug, state) {
  return oauthStateCookieName(slug) + "=" + state + "; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=None";
}

function expiredOAuthStateCookie(slug) {
  return oauthStateCookieName(slug) + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None";
}

function oauthRedirect(env, values = {}, cookies = []) {
  const origin = getAllowedOrigin(env);
  if (!origin) {
    return new Response(JSON.stringify({ error: "APP_ORIGIN ist nicht als sichere HTTPS-Origin konfiguriert." }), {
      status: 503,
      headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" }
    });
  }
  const target = new URL("/", origin);
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && value.length <= 200) target.searchParams.set(key, value);
  }
  const headers = new Headers({
    "Location": target.toString(),
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

async function handleOAuthStart(request, env, db, slug) {
  const config = parseOAuthProviders(env)[slug];
  if (!config) return oauthRedirect(env, { oauth_error: "provider_not_configured" });
  const origin = apiOrigin(request, env);
  if (!origin || !getAllowedOrigin(env)) return json(request, env, { error: "OAuth-API oder Frontend-Origin ist nicht sicher konfiguriert." }, 503);
  if (!(await consumeRateLimit(request, env, "oauth-start", slug, 20))) {
    return oauthRedirect(env, { oauth_error: "login_failed" });
  }
  const current = await currentSession(request, env);
  const state = randomToken(32);
  const verifier = config.pkce ? randomToken(48) : "";
  const now = Date.now();
  await db.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(now).run();
  await db.prepare("INSERT INTO oauth_states(state_hash,provider,code_verifier,user_id,expires_at,created_at) VALUES(?,?,?,?,?,?)")
    .bind(await sha256(state), slug, verifier || null, current ? current.user.id : null, now + 10 * 60 * 1000, now).run();

  const callbackUrl = origin + "/api/auth/oauth/" + slug + "/callback";
  const authorize = new URL(config.authorizeUrl);
  for (const [key, value] of Object.entries(config.extraAuthorizeParams)) authorize.searchParams.set(key, value);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("redirect_uri", callbackUrl);
  authorize.searchParams.set("scope", config.scopes);
  authorize.searchParams.set("state", state);
  if (verifier) {
    const challengeBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    authorize.searchParams.set("code_challenge", b64url(challengeBytes));
    authorize.searchParams.set("code_challenge_method", "S256");
  }
  return new Response(null, {
    status: 302,
    headers: {
      "Location": authorize.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": oauthStateCookie(slug, state),
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function handleOAuthCallback(request, env, db, slug) {
  const config = parseOAuthProviders(env)[slug];
  const clearStateCookie = expiredOAuthStateCookie(slug);
  if (!config || !getAllowedOrigin(env)) {
    return oauthRedirect(env, { oauth_error: "provider_not_configured" }, [clearStateCookie]);
  }
  const publicApiOrigin = apiOrigin(request, env);
  if (!publicApiOrigin) return oauthRedirect(env, { oauth_error: "login_failed" }, [clearStateCookie]);
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const cookieState = cookieValue(request, oauthStateCookieName(slug));
  if (!state || state.length > 256 || !cookieState ||
      !constantTimeEqual(new TextEncoder().encode(state), new TextEncoder().encode(cookieState))) {
    return oauthRedirect(env, { oauth_error: "invalid_state" }, [clearStateCookie]);
  }

  const stateHash = await sha256(state);
  const flow = await db.prepare("SELECT state_hash,provider,code_verifier,user_id,expires_at FROM oauth_states WHERE state_hash=? AND provider=? AND expires_at>?")
    .bind(stateHash, slug, Date.now()).first();
  if (!flow) return oauthRedirect(env, { oauth_error: "invalid_state" }, [clearStateCookie]);
  const consumed = await db.prepare("DELETE FROM oauth_states WHERE state_hash=? AND provider=? AND expires_at>?")
    .bind(stateHash, slug, Date.now()).run();
  if (!consumed.meta || consumed.meta.changes !== 1) {
    return oauthRedirect(env, { oauth_error: "invalid_state" }, [clearStateCookie]);
  }

  if (url.searchParams.has("error") || !url.searchParams.get("code") || url.searchParams.get("code").length > 4096) {
    return oauthRedirect(env, { oauth_error: "provider_denied" }, [clearStateCookie]);
  }
  if (!(await consumeRateLimit(request, env, "oauth-callback", slug, 30))) {
    return oauthRedirect(env, { oauth_error: "login_failed" }, [clearStateCookie]);
  }

  if (flow.user_id) {
    const current = await currentSession(request, env);
    if (!current || current.user.id !== flow.user_id) {
      return oauthRedirect(env, { oauth_error: "account_missing" }, [clearStateCookie]);
    }
  }

  try {
    const callbackUrl = publicApiOrigin + "/api/auth/oauth/" + slug + "/callback";
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: url.searchParams.get("code"),
      redirect_uri: callbackUrl
    });
    const tokenHeaders = new Headers({ "Accept": "application/json" });
    if (config.clientAuthMethod === "basic") {
      tokenHeaders.set("Authorization", "Basic " + btoa(config.clientId + ":" + config.clientSecret));
    } else {
      tokenBody.set("client_id", config.clientId);
      tokenBody.set("client_secret", config.clientSecret);
    }
    if (flow.code_verifier) tokenBody.set("code_verifier", flow.code_verifier);
    tokenHeaders.set("Content-Type", "application/x-www-form-urlencoded");
    const tokenResponse = await fetch(config.tokenUrl, {
      method: "POST",
      headers: tokenHeaders,
      body: tokenBody.toString(),
      redirect: "error",
      signal: AbortSignal.timeout(10000)
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || typeof tokenData.access_token !== "string" || !tokenData.access_token) {
      return oauthRedirect(env, { oauth_error: "login_failed" }, [clearStateCookie]);
    }

    const userInfoHeaders = new Headers({
      "Authorization": "Bearer " + tokenData.access_token,
      "Accept": "application/json"
    });
    if (config.clientIdHeader) userInfoHeaders.set(config.clientIdHeader, config.clientId);
    const userInfoResponse = await fetch(config.userInfoUrl, {
      method: "GET",
      headers: userInfoHeaders,
      redirect: "error",
      signal: AbortSignal.timeout(10000)
    });
    const userInfo = await userInfoResponse.json().catch(() => ({}));
    if (!userInfoResponse.ok || !userInfo || typeof userInfo !== "object" || Array.isArray(userInfo)) {
      return oauthRedirect(env, { oauth_error: "login_failed" }, [clearStateCookie]);
    }
    const profile = config.userInfoPath ? readOAuthField(userInfo, config.userInfoPath) : userInfo;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      return oauthRedirect(env, { oauth_error: "login_failed" }, [clearStateCookie]);
    }
    const providerUserId = readOAuthField(profile, config.idField) ?? readOAuthField(profile, "id") ?? readOAuthField(profile, "sub");
    if (providerUserId === undefined || providerUserId === null || !String(providerUserId) || String(providerUserId).length > 255) {
      return oauthRedirect(env, { oauth_error: "login_failed" }, [clearStateCookie]);
    }
    const providerUserIdText = String(providerUserId);
    const rawDisplayName = readOAuthField(profile, config.nameField) ?? readOAuthField(profile, "username") ?? slug;
    const displayName = String(rawDisplayName).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120) || slug;

    if (flow.user_id) {
      const identity = await db.prepare("SELECT user_id FROM oauth_identities WHERE provider=? AND provider_user_id=?")
        .bind(slug, providerUserIdText).first();
      if (identity && identity.user_id !== flow.user_id) {
        return oauthRedirect(env, { oauth_error: "identity_already_linked" }, [clearStateCookie]);
      }
      if (!identity) {
        await db.prepare("INSERT INTO oauth_identities(provider,provider_user_id,user_id,display_name,created_at) VALUES(?,?,?,?,?)")
          .bind(slug, providerUserIdText, flow.user_id, displayName, new Date().toISOString()).run();
      }
      return oauthRedirect(env, { oauth: "linked", provider: slug }, [clearStateCookie]);
    }

    let identity = await db.prepare("SELECT user_id FROM oauth_identities WHERE provider=? AND provider_user_id=?")
      .bind(slug, providerUserIdText).first();
    let userId = identity ? identity.user_id : "";
    if (userId) {
      const exists = await db.prepare("SELECT id FROM users WHERE id=?").bind(userId).first();
      if (!exists) {
        await db.prepare("DELETE FROM oauth_identities WHERE provider=? AND provider_user_id=?").bind(slug, providerUserIdText).run();
        userId = "";
      }
    }

    if (!userId) {
      const base = (slug + "_" + displayName).normalize("NFKD").toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 22) || slug;
      let username = "";
      for (let attempt = 0; attempt < 12; attempt++) {
        const suffix = randomToken(5).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8);
        const candidate = (base + "_" + suffix).slice(0, 32);
        const taken = await db.prepare("SELECT 1 AS ok FROM users WHERE username_normalized=?").bind(candidate.toLowerCase()).first();
        if (!taken) { username = candidate; break; }
      }
      if (!username) return oauthRedirect(env, { oauth_error: "login_failed" }, [clearStateCookie]);

      let email = "";
      const candidateEmail = readOAuthField(profile, "email");
      const verifiedValue = config.emailVerifiedField ? readOAuthField(profile, config.emailVerifiedField) : false;
      const emailVerified = verifiedValue === true || verifiedValue === "true";
      if (emailVerified && typeof candidateEmail === "string" && candidateEmail.length <= 254 && EMAIL_PATTERN.test(candidateEmail)) {
        const normalizedEmail = candidateEmail.trim().toLowerCase();
        const takenEmail = await db.prepare("SELECT id FROM users WHERE email_normalized=?").bind(normalizedEmail).first();
        if (!takenEmail) email = candidateEmail.trim();
      }
      const user = {
        id: crypto.randomUUID(),
        username,
        username_normalized: username.toLowerCase(),
        email: email || null,
        email_normalized: email ? email.toLowerCase() : null,
        password_hash: await hashPassword(randomToken(48)),
        created_at: new Date().toISOString()
      };
      await db.prepare("INSERT INTO users(id,username,username_normalized,email,email_normalized,password_hash,created_at) VALUES(?,?,?,?,?,?,?)")
        .bind(user.id, user.username, user.username_normalized, user.email, user.email_normalized, user.password_hash, user.created_at).run();
      try {
        await db.prepare("INSERT INTO oauth_identities(provider,provider_user_id,user_id,display_name,created_at) VALUES(?,?,?,?,?)")
          .bind(slug, providerUserIdText, user.id, displayName, user.created_at).run();
        userId = user.id;
      } catch (error) {
        await db.prepare("DELETE FROM users WHERE id=?").bind(user.id).run();
        identity = await db.prepare("SELECT user_id FROM oauth_identities WHERE provider=? AND provider_user_id=?")
          .bind(slug, providerUserIdText).first();
        if (!identity) throw error;
        userId = identity.user_id;
      }
    }

    const linkedUser = await db.prepare("SELECT id FROM users WHERE id=?").bind(userId).first();
    if (!linkedUser) return oauthRedirect(env, { oauth_error: "login_failed" }, [clearStateCookie]);
    await revokeCurrentSession(request, env);
    const token = await createSession(env, userId);
    return oauthRedirect(env, { oauth: "success", provider: slug }, [clearStateCookie, sessionCookie(token)]);
  } catch {
    return oauthRedirect(env, { oauth_error: "login_failed" }, [clearStateCookie]);
  }
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const authPath = path.startsWith("/api/auth/") || path === "/api/account" || path.startsWith("/api/account/") || path === "/api/health" || path === "/api/ready";
  if (!authPath) return json(request, env, { error: "API-Endpunkt nicht gefunden." }, 404);

  if (request.method === "OPTIONS") {
    if (!originAllowed(request, env)) return json(request, env, { error: "Origin nicht erlaubt." }, 403);
    return new Response(null, { status: 204, headers: responseHeaders(request, env) });
  }

  if (request.method === "GET" && (path === "/api/health" || path === "/api/ready")) {
    try {
      if (String(env.RATE_LIMIT_SECRET || "").length < 32) {
        return json(request, env, { ok: false, ready: false, error: "Rate-Limit-Geheimnis ist nicht sicher konfiguriert." }, 503);
      }
      await ensureSchema(env.AUTH_DB);
      await env.AUTH_DB.prepare("SELECT 1 AS ok").first();
      return json(request, env, { ok: true, ready: true, service: "all-world-auth-api" });
    } catch {
      return json(request, env, { ok: false, ready: false, error: "Authentifizierungsdatenbank ist nicht verfügbar." }, 503);
    }
  }

  if (["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) {
    if (!getAllowedOrigin(env)) return json(request, env, { error: "APP_ORIGIN ist nicht als sichere HTTPS-Origin konfiguriert." }, 503);
    if (!originAllowed(request, env)) return json(request, env, { error: "Anfrage-Origin nicht erlaubt." }, 403);
  }

  if (String(env.RATE_LIMIT_SECRET || "").length < 32) {
    return json(request, env, { error: "Rate-Limit-Geheimnis ist nicht sicher konfiguriert." }, 503);
  }

  try {
    await ensureSchema(env.AUTH_DB);
    const db = env.AUTH_DB;

    if (request.method === "GET" && path === "/api/auth/providers") {
      const providers = parseOAuthProviders(env);
      return json(request, env, {
        providers: Object.entries(providers).map(([id, config]) => ({ id, label: config.label, enabled: true })),
        oauthAvailable: Object.keys(providers).length > 0
      });
    }

    if (path.startsWith("/api/auth/oauth/")) {
      const match = path.match(/^\/api\/auth\/oauth\/([a-z0-9][a-z0-9_-]{0,31})(\/callback)?$/i);
      if (!match) return json(request, env, { error: "OAuth-Endpunkt nicht gefunden." }, 404);
      if (request.method !== "GET") return json(request, env, { error: "OAuth-Callback muss als GET aufgerufen werden." }, 405);
      const slug = match[1].toLowerCase();
      return match[2]
        ? await handleOAuthCallback(request, env, db, slug)
        : await handleOAuthStart(request, env, db, slug);
    }

    if (request.method === "POST" && path === "/api/auth/register") {
      let body;
      try { body = await readJson(request); }
      catch (error) {
        return json(request, env, { error: error.message === "body_too_large" ? "Anfrage ist zu groß." : "Ungültiges JSON." }, 400);
      }
      const username = typeof body.username === "string" ? body.username.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const emailNormalized = email ? email.toLowerCase() : null;
      const password = typeof body.password === "string" ? body.password : "";
      if (!(await consumeRateLimit(request, env, "register", "", 5))) {
        return json(request, env, { error: "Zu viele Registrierungsversuche. Bitte warte 15 Minuten." }, 429, { "Retry-After": "900" });
      }
      if (!USERNAME_PATTERN.test(username)) {
        return json(request, env, { error: "Der Benutzername muss 3–32 Zeichen lang sein und darf Buchstaben, Zahlen, _ und - enthalten." }, 400);
      }
      if (email.length > 254 || (email && !EMAIL_PATTERN.test(email))) {
        return json(request, env, { error: "Gib eine gültige E-Mail-Adresse ein." }, 400);
      }
      if (password.length < 8 || password.length > 72 || new TextEncoder().encode(password).length > 72) {
        return json(request, env, { error: "Das Passwort muss 8–72 Zeichen lang sein." }, 400);
      }
      const user = {
        id: crypto.randomUUID(),
        username,
        username_normalized: username.toLowerCase(),
        email: email || null,
        email_normalized: emailNormalized,
        password_hash: await hashPassword(password),
        created_at: new Date().toISOString()
      };
      try {
        await db.prepare("INSERT INTO users(id,username,username_normalized,email,email_normalized,password_hash,created_at) VALUES(?,?,?,?,?,?,?)")
          .bind(user.id, user.username, user.username_normalized, user.email, user.email_normalized, user.password_hash, user.created_at).run();
      } catch (error) {
        const message = String(error && error.message || "");
        if (message.includes("users.username_normalized")) return json(request, env, { error: "Dieser Benutzername ist bereits vergeben." }, 409);
        if (message.includes("users.email_normalized")) return json(request, env, { error: "Diese E-Mail-Adresse wird bereits verwendet." }, 409);
        if (/UNIQUE constraint failed: users\./i.test(message)) return json(request, env, { error: "Benutzername oder E-Mail-Adresse wird bereits verwendet." }, 409);
        throw error;
      }
      await revokeCurrentSession(request, env);
      const token = await createSession(env, user.id);
      return json(request, env, { user: publicUser(user) }, 201, { "Set-Cookie": sessionCookie(token) });
    }

    if (request.method === "POST" && path === "/api/auth/login") {
      let body;
      try { body = await readJson(request); }
      catch (error) {
        return json(request, env, { error: error.message === "body_too_large" ? "Anfrage ist zu groß." : "Ungültiges JSON." }, 400);
      }
      const identifier = typeof body.username === "string" ? body.username.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const loginIpAllowed = await consumeRateLimit(request, env, "login-ip", "", 40);
      const loginIdentityAllowed = await consumeRateLimit(request, env, "login-identifier", identifier, 10);
      if (!loginIpAllowed || !loginIdentityAllowed) {
        return json(request, env, { error: "Zu viele Anmeldeversuche. Bitte warte 15 Minuten." }, 429, { "Retry-After": "900" });
      }
      if (!identifier || identifier.length > 254 || password.length > 72) {
        return json(request, env, { error: "Benutzername/E-Mail oder Passwort ist falsch." }, 401);
      }
      const normalized = identifier.toLowerCase();
      const user = await db.prepare(
        "SELECT id,username,username_normalized,email,email_normalized,password_hash,created_at FROM users WHERE username_normalized=? OR email_normalized=? LIMIT 1"
      ).bind(normalized, normalized).first();
      const passwordOk = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
      if (!user || !passwordOk) return json(request, env, { error: "Benutzername/E-Mail oder Passwort ist falsch." }, 401);
      await revokeCurrentSession(request, env);
      const token = await createSession(env, user.id);
      return json(request, env, { user: publicUser(user) }, 200, { "Set-Cookie": sessionCookie(token) });
    }

    if (request.method === "GET" && path === "/api/auth/me") {
      const session = await currentSession(request, env);
      return json(request, env, { user: session ? publicUser(session.user) : null }, 200,
        session ? {} : (cookieValue(request) ? { "Set-Cookie": expiredCookie() } : {}));
    }

    if (request.method === "POST" && path === "/api/auth/logout") {
      const token = cookieValue(request);
      if (token) await db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
      return json(request, env, { ok: true }, 200, { "Set-Cookie": expiredCookie() });
    }

    if (request.method === "GET" && path === "/api/auth/linked") {
      const required = await requireSession(request, env);
      if (required.response) return required.response;
      const current = required.session.user;
      const rows = await db.prepare(
        "SELECT u.id,u.username,u.email,u.created_at FROM users u JOIN account_links l ON l.linked_user_id=u.id WHERE l.user_id=? ORDER BY u.username_normalized"
      ).bind(current.id).all();
      const accounts = [publicUser(current), ...(rows.results || []).map(publicUser).filter(row => row.id !== current.id)];
      return json(request, env, { accounts });
    }

    if (request.method === "POST" && path === "/api/auth/link") {
      const required = await requireSession(request, env);
      if (required.response) return required.response;
      let body;
      try { body = await readJson(request); }
      catch { return json(request, env, { error: "Ungültiges JSON." }, 400); }
      const username = typeof body.username === "string" ? body.username.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!username || !password || username.length > 32 || password.length > 72) {
        return json(request, env, { error: "Gib Benutzername und Passwort des zu verbindenden Kontos ein." }, 400);
      }
      const linkIpAllowed = await consumeRateLimit(request, env, "link-ip", "", 20);
      const linkIdentityAllowed = await consumeRateLimit(request, env, "link-identity", username, 10);
      if (!linkIpAllowed || !linkIdentityAllowed) {
        return json(request, env, { error: "Zu viele Versuche. Bitte warte 15 Minuten." }, 429, { "Retry-After": "900" });
      }
      const target = await db.prepare("SELECT id,username,email,password_hash,created_at FROM users WHERE username_normalized=?")
        .bind(username.toLowerCase()).first();
      const passwordOk = await verifyPassword(password, target ? target.password_hash : DUMMY_HASH);
      if (!target || !passwordOk) return json(request, env, { error: "Kontodaten stimmen nicht. Bestätige das andere Konto mit seinem Passwort." }, 401);
      if (target.id === required.session.user.id) return json(request, env, { error: "Dieses Konto ist bereits aktiv." }, 400);
      const now = new Date().toISOString();
      await db.prepare("INSERT OR IGNORE INTO account_links(user_id,linked_user_id,created_at) VALUES(?,?,?)")
        .bind(required.session.user.id, target.id, now).run();
      await db.prepare("INSERT OR IGNORE INTO account_links(user_id,linked_user_id,created_at) VALUES(?,?,?)")
        .bind(target.id, required.session.user.id, now).run();
      return json(request, env, { account: publicUser(target) }, 201);
    }

    if (request.method === "POST" && path === "/api/auth/switch") {
      const required = await requireSession(request, env);
      if (required.response) return required.response;
      let body;
      try { body = await readJson(request); }
      catch { return json(request, env, { error: "Ungültiges JSON." }, 400); }
      const accountId = typeof body.accountId === "string" ? body.accountId : "";
      const allowed = await db.prepare("SELECT 1 AS ok FROM account_links WHERE user_id=? AND linked_user_id=?")
        .bind(required.session.user.id, accountId).first();
      const target = allowed ? await db.prepare("SELECT id,username,email,created_at FROM users WHERE id=?").bind(accountId).first() : null;
      if (!target) return json(request, env, { error: "Dieses Konto ist nicht mit deinem aktiven Konto verbunden." }, 403);
      await db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(required.session.tokenHash).run();
      const token = await createSession(env, target.id);
      return json(request, env, { user: publicUser(target) }, 200, { "Set-Cookie": sessionCookie(token) });
    }

    if (request.method === "GET" && path === "/api/account") {
      const required = await requireSession(request, env);
      if (required.response) return required.response;
      return json(request, env, { user: publicUser(required.session.user) });
    }

    if (request.method === "GET" && path === "/api/account/data") {
      const required = await requireSession(request, env);
      if (required.response) return required.response;
      const rows = await db.prepare("SELECT id,type,data_json,created_at,updated_at FROM user_data WHERE user_id=? ORDER BY updated_at DESC")
        .bind(required.session.user.id).all();
      const items = (rows.results || []).map(row => {
        let data = {};
        try { data = JSON.parse(row.data_json); } catch {}
        return { id: row.id, type: row.type, data, createdAt: row.created_at, updatedAt: row.updated_at };
      });
      return json(request, env, { items });
    }

    if (request.method === "POST" && path === "/api/account/data") {
      const required = await requireSession(request, env);
      if (required.response) return required.response;
      let body;
      try { body = await readJson(request); }
      catch { return json(request, env, { error: "Ungültiges JSON." }, 400); }
      const type = typeof body.type === "string" ? body.type.trim() : "";
      const data = body.data;
      if (!type || type.length > 50 || !data || typeof data !== "object" || Array.isArray(data)) {
        return json(request, env, { error: "Gib einen Datentyp und ein JSON-Objekt ein." }, 400);
      }
      const dataJson = JSON.stringify(data);
      if (dataJson.length > 20000) return json(request, env, { error: "Der Datensatz ist zu groß." }, 413);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.prepare("INSERT INTO user_data(id,user_id,type,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?)")
        .bind(id, required.session.user.id, type, dataJson, now, now).run();
      return json(request, env, { item: { id, type, data, createdAt: now, updatedAt: now } }, 201);
    }

    if ((request.method === "PUT" || request.method === "DELETE") && path.startsWith("/api/account/data/")) {
      const required = await requireSession(request, env);
      if (required.response) return required.response;
      let id;
      try { id = decodeURIComponent(path.slice("/api/account/data/".length)); }
      catch { return json(request, env, { error: "Ungültige Datensatz-ID." }, 400); }
      if (!id || id.length > 100 || id.includes("/")) return json(request, env, { error: "Ungültige Datensatz-ID." }, 400);
      if (request.method === "DELETE") {
        const result = await db.prepare("DELETE FROM user_data WHERE id=? AND user_id=?").bind(id, required.session.user.id).run();
        if (!result.meta || result.meta.changes === 0) return json(request, env, { error: "Datensatz nicht gefunden." }, 404);
        return json(request, env, { ok: true });
      }
      let body;
      try { body = await readJson(request); }
      catch { return json(request, env, { error: "Ungültiges JSON." }, 400); }
      const type = typeof body.type === "string" ? body.type.trim() : "";
      const data = body.data;
      if (!type || type.length > 50 || !data || typeof data !== "object" || Array.isArray(data)) {
        return json(request, env, { error: "Gib einen Datentyp und ein JSON-Objekt ein." }, 400);
      }
      const dataJson = JSON.stringify(data);
      if (dataJson.length > 20000) return json(request, env, { error: "Der Datensatz ist zu groß." }, 413);
      const updatedAt = new Date().toISOString();
      const result = await db.prepare("UPDATE user_data SET type=?,data_json=?,updated_at=? WHERE id=? AND user_id=?")
        .bind(type, dataJson, updatedAt, id, required.session.user.id).run();
      if (!result.meta || result.meta.changes === 0) return json(request, env, { error: "Datensatz nicht gefunden." }, 404);
      return json(request, env, { item: { id, type, data, updatedAt } });
    }

    if (request.method === "DELETE" && path === "/api/account") {
      const required = await requireSession(request, env);
      if (required.response) return required.response;
      let body;
      try { body = await readJson(request); }
      catch { return json(request, env, { error: "Ungültiges JSON." }, 400); }
      const password = typeof body.password === "string" ? body.password : "";
      const passwordOk = password && password.length <= 72 && await verifyPassword(password, required.session.user.password_hash);
      if (!passwordOk) return json(request, env, { error: "Gib zur Bestätigung dein aktuelles Passwort ein." }, 401);
      const userId = required.session.user.id;
      await db.prepare("DELETE FROM user_data WHERE user_id=?").bind(userId).run();
      await db.prepare("DELETE FROM account_links WHERE user_id=? OR linked_user_id=?").bind(userId, userId).run();
      await db.prepare("DELETE FROM oauth_identities WHERE user_id=?").bind(userId).run();
      await db.prepare("DELETE FROM sessions WHERE user_id=?").bind(userId).run();
      await db.prepare("DELETE FROM users WHERE id=?").bind(userId).run();
      return json(request, env, { ok: true, deleted: true }, 200, { "Set-Cookie": expiredCookie() });
    }

    return json(request, env, { error: "API-Endpunkt nicht gefunden." }, 404);
  } catch {
    return json(request, env, { error: "Interner Authentifizierungsfehler." }, 500);
  }
}

export default {
  async fetch(request, env) {
    return handle(request, env || {});
  }
};
