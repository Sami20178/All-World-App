const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "all-world-api-test-"));
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverPath = path.join(__dirname, "..", "server.js");
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      APP_ORIGIN: "http://localhost:5500",
      SESSION_SECRET: "ci-only-session-secret-not-used-in-production",
      DATA_DIR: dataDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let logs = "";
  child.stdout.on("data", chunk => { logs += chunk.toString(); });
  child.stderr.on("data", chunk => { logs += chunk.toString(); });

  const request = (route, options = {}) => fetch(baseUrl + route, options);
  const jsonRequest = (route, payload, cookie) => request(route, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(payload)
  });
  const cookieFrom = response => {
    const value = response.headers.get("set-cookie") || "";
    const match = value.match(/allworld\.sid=[^;]*/);
    return match ? match[0] : "";
  };

  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode !== null) throw new Error("API process exited before becoming ready. " + logs);
      try {
        const response = await request("/api/health");
        if (response.ok && (await response.json()).service === "all-world-api") {
          ready = true;
          break;
        }
      } catch (_) {}
      await delay(100);
    }
    assert.equal(ready, true, "API did not become ready. " + logs);

    const health = await request("/api/health");
    assert.equal(health.status, 200, "health endpoint should return HTTP 200");

    const invalid = await jsonRequest("/api/auth/register", { username: "x", password: "short" });
    assert.equal(invalid.status, 400, "invalid registration should be rejected");

    const username = "ci_" + Date.now().toString(36);
    const password = "Test-password-2026!";
    const registered = await jsonRequest("/api/auth/register", { username, password });
    assert.equal(registered.status, 201, "registration should create an account");
    const registeredBody = await registered.json();
    assert.equal(registeredBody.user.username, username);
    const registeredCookie = cookieFrom(registered);
    assert.ok(registeredCookie, "registration should set the session cookie");

    const duplicate = await jsonRequest("/api/auth/register", { username, password });
    assert.equal(duplicate.status, 409, "duplicate username should be rejected");

    const me = await request("/api/auth/me", { headers: { cookie: registeredCookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.username, username);

    const account = await request("/api/account", { headers: { cookie: registeredCookie } });
    assert.equal(account.status, 200, "authenticated account endpoint should succeed");

    const loggedOut = await jsonRequest("/api/auth/logout", {}, registeredCookie);
    assert.equal(loggedOut.status, 200, "logout should succeed");

    const unauthorized = await request("/api/account");
    assert.equal(unauthorized.status, 401, "account endpoint should reject unauthenticated requests");

    const badLogin = await jsonRequest("/api/auth/login", { username, password: "incorrect-password" });
    assert.equal(badLogin.status, 401, "incorrect password should be rejected");

    const login = await jsonRequest("/api/auth/login", { username, password });
    assert.equal(login.status, 200, "valid login should succeed");
    const loginCookie = cookieFrom(login);
    assert.ok(loginCookie, "login should set a session cookie");

    const logout = await jsonRequest("/api/auth/logout", {}, loginCookie);
    assert.equal(logout.status, 200);

    console.log("All World API smoke tests passed: health, validation, registration, duplicate protection, session, account authorization, login, logout.");
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once("exit", resolve));
      child.kill("SIGTERM");
      await Promise.race([exited, delay(1500)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
