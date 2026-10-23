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
  "CREATE TABLE IF NOT EXISTS auth_rate_limits (key_hash TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)"
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

function cookieValue(request) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === COOKIE_NAME) return part.slice(index + 1).trim();
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

async function consumeRateLimit(request, env, action, identity, limit) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = await sha256(ip + "|" + action + "|" + String(identity || "").toLowerCase());
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

  try {
    await ensureSchema(env.AUTH_DB);
    const db = env.AUTH_DB;

    if (request.method === "GET" && path === "/api/auth/providers") {
      return json(request, env, { providers: [], oauthAvailable: false });
    }

    if (path.startsWith("/api/auth/oauth/")) {
      return json(request, env, { error: "OAuth-Anmeldung ist für diesen API-Endpunkt noch nicht aktiviert." }, 503);
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
