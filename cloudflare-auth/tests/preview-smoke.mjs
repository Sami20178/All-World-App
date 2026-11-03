import { randomUUID } from "node:crypto";
import { resolvePreviewBase } from "../preview-target.mjs";

const base = resolvePreviewBase(process.env.AUTH_PREVIEW_BASE_URL || undefined);
const origin = "https://auth-preview.invalid";
const password = "Preview-only-long-password!";

async function call(path, { method = "GET", body, cookie } = {}) {
  const headers = { accept: "application/json", origin };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(base + path, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(path + " did not return JSON"); }
  return { response, data };
}

function sessionCookie(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  const value = values.find(item => item.startsWith("allworld.sid="));
  if (!value) return "";
  return value.split(";")[0];
}

let activeCookie = "";
let username = "";
let email = "";
let accountDeleted = false;

try {
  const health = await call("/api/health");
  if (!health.response.ok || health.data.ok !== true || health.data.service !== "all-world-auth-api") {
    throw new Error("Preview health check failed");
  }

  const ready = await call("/api/ready");
  if (!ready.response.ok || ready.data.ok !== true || ready.data.ready !== true) {
    throw new Error("Preview readiness check failed");
  }

  const id = randomUUID().replace(/-/g, "").slice(0, 12);
  username = "ci_" + id;
  email = "ci-" + id + "@example.test";

  const protectedRoute = await call("/api/account");
  if (protectedRoute.response.status !== 401) {
    throw new Error("Protected account route did not reject an anonymous request");
  }

  const registered = await call("/api/auth/register", {
    method: "POST",
    body: { username, email, password }
  });
  if (registered.response.status !== 201 || registered.data.user?.email !== email) {
    throw new Error("Preview registration failed with HTTP " + registered.response.status);
  }
  activeCookie = sessionCookie(registered.response);
  if (!activeCookie) throw new Error("Registration did not set the session cookie");
  if (registered.response.headers.get("access-control-allow-origin") !== origin) {
    throw new Error("Preview CORS origin did not match the configured test origin");
  }
  const setCookie = registered.response.headers.get("set-cookie") || "";
  if (!/httponly/i.test(setCookie)) throw new Error("Session cookie is missing HttpOnly");
  if (!/secure/i.test(setCookie)) throw new Error("Session cookie is missing Secure");
  if (!/samesite=none/i.test(setCookie)) throw new Error("Session cookie is missing SameSite=None for cross-origin credentials");

  const me = await call("/api/auth/me", { cookie: activeCookie });
  if (me.data.user?.username !== username) throw new Error("Session restoration failed");

  const badLogin = await call("/api/auth/login", {
    method: "POST",
    body: { username: email, password: "incorrect-preview-password" }
  });
  if (badLogin.response.status !== 401) throw new Error("Incorrect password was not rejected");

  const login = await call("/api/auth/login", {
    method: "POST",
    body: { username: email, password },
    cookie: activeCookie
  });
  if (login.response.status !== 200) throw new Error("Email login failed");
  const newCookie = sessionCookie(login.response);
  if (!newCookie) throw new Error("Login did not set a new session cookie");

  const oldSession = await call("/api/auth/me", { cookie: activeCookie });
  if (oldSession.data.user !== null) throw new Error("Login did not invalidate the previous session");
  activeCookie = newCookie;

  const account = await call("/api/account", { cookie: activeCookie });
  if (!account.response.ok || account.data.user?.username !== username) {
    throw new Error("Authenticated account endpoint failed");
  }

  const logout = await call("/api/auth/logout", { method: "POST", cookie: activeCookie });
  if (!logout.response.ok) throw new Error("Logout failed");
  const afterLogout = await call("/api/auth/me", { cookie: activeCookie });
  if (afterLogout.data.user !== null) throw new Error("Logout did not invalidate the session");

  const relogin = await call("/api/auth/login", {
    method: "POST",
    body: { username: email, password }
  });
  if (relogin.response.status !== 200) throw new Error("Re-login for cleanup failed");
  activeCookie = sessionCookie(relogin.response);

  const deleted = await call("/api/account", {
    method: "DELETE",
    body: { password },
    cookie: activeCookie
  });
  if (!deleted.response.ok || deleted.data.deleted !== true) {
    throw new Error("Synthetic preview account cleanup failed");
  }
  accountDeleted = true;
  activeCookie = "";

  const deletedLogin = await call("/api/auth/login", {
    method: "POST",
    body: { username: email, password }
  });
  if (deletedLogin.response.status !== 401) {
    throw new Error("Deleted preview account could still log in");
  }

  console.log("PASS isolated auth preview: health, readiness, anonymous protection, registration, session restore, email login, invalid-password rejection, session rotation, logout, account deletion");
} finally {
  if (!accountDeleted && username && email) {
    try {
      let cleanupCookie = activeCookie;
      if (cleanupCookie) {
        const attempt = await call("/api/account", {
          method: "DELETE",
          body: { password },
          cookie: cleanupCookie
        });
        if (attempt.response.ok) accountDeleted = true;
      }
      if (!accountDeleted) {
        const cleanupLogin = await call("/api/auth/login", {
          method: "POST",
          body: { username: email, password }
        });
        cleanupCookie = sessionCookie(cleanupLogin.response);
        if (cleanupLogin.response.ok && cleanupCookie) {
          await call("/api/account", {
            method: "DELETE",
            body: { password },
            cookie: cleanupCookie
          });
        }
      }
    } catch {
      // Cleanup is best-effort; only synthetic data in the isolated preview DB is involved.
    }
  }
}
