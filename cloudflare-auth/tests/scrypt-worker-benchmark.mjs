import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

const port = 8793;
const baseUrl = `http://127.0.0.1:${port}`;
const configPath = new URL("../wrangler.scrypt-benchmark.jsonc", import.meta.url).pathname;
const password = utf8ToBytes("All World isolated Worker KDF benchmark — äöü 🔐");
const salt = Uint8Array.from({ length: 16 }, (_, index) => index);

const candidates = [
  { key: "32", name: "OWASP 32 MiB", N: 2 ** 15, r: 8, p: 3, required: true },
  { key: "64", name: "OWASP 64 MiB", N: 2 ** 16, r: 8, p: 2, required: false }
];

function toHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function redactedLogs(value) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  return token ? value.split(token).join("[REDACTED]") : value;
}

const child = spawn("npx", [
  "--yes",
  "wrangler@4",
  "dev",
  "--remote",
  "--config",
  configPath,
  "--ip",
  "127.0.0.1",
  "--port",
  String(port),
  "--log-level",
  "warn"
], {
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env
});

let logs = "";
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", chunk => {
    logs = (logs + chunk.toString()).slice(-20000);
  });
}

async function stop() {
  if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
  if (child.exitCode === null) {
    await Promise.race([
      new Promise(resolve => child.once("exit", resolve)),
      delay(5000)
    ]);
  }
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (child.exitCode !== null) {
      throw new Error("wrangler dev --remote exited before readiness:\n" + redactedLogs(logs));
    }
    try {
      const response = await fetch(baseUrl + "/health", { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const body = await response.json();
        assert.equal(body.ok, true);
        assert.equal(body.service, "all-world-auth-kdf-benchmark");
        ready = true;
        break;
      }
    } catch {}
    await delay(1000);
  }
  assert.equal(ready, true, "Remote Worker did not become ready:\n" + redactedLogs(logs));

  let completed = 0;
  for (const candidate of candidates) {
    const response = await fetch(baseUrl + "/benchmark?candidate=" + candidate.key, {
      method: "POST",
      signal: AbortSignal.timeout(120000)
    }).catch(error => ({ transportError: error }));

    if (response.transportError || !response.ok) {
      const detail = response.transportError
        ? String(response.transportError.message || response.transportError)
        : (await response.text()).slice(0, 300);
      if (candidate.required) throw new Error(candidate.name + " failed in the Worker runtime: " + detail);
      console.warn("KDF_WORKER_BENCHMARK_BLOCKED " + JSON.stringify({
        candidate: candidate.name,
        reason: detail
      }));
      continue;
    }

    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.candidate, candidate.name);
    assert.equal(result.derivedBytes, 32);

    const targetMemoryBytes = 128 * candidate.r * (candidate.N + candidate.p + 1);
    const expected = await scryptAsync(password, salt, {
      N: candidate.N,
      r: candidate.r,
      p: candidate.p,
      dkLen: 32,
      maxmem: targetMemoryBytes + 1024 * 1024
    });
    assert.equal(result.derivedKeyHex, toHex(expected), "Worker result must match the Node.js reference");

    console.log("KDF_WORKER_BENCHMARK " + JSON.stringify({
      candidate: result.candidate,
      N: result.N,
      r: result.r,
      p: result.p,
      targetMemoryBytes: result.targetMemoryBytes,
      elapsedMs: result.elapsedMs,
      derivedBytes: result.derivedBytes,
      resultMatchesNode: true
    }));
    completed++;
  }

  assert.ok(completed >= 1, "No scrypt candidate completed in the remote Worker runtime");

  const rejected = await fetch(baseUrl + "/benchmark?candidate=128", {
    method: "POST",
    signal: AbortSignal.timeout(10000)
  });
  assert.equal(rejected.status, 400);
  console.log("PASS isolated Cloudflare Worker scrypt benchmark; completed candidates: " + completed);
} finally {
  await stop();
}
