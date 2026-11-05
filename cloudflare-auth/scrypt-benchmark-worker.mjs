import { scryptAsync } from "@noble/hashes/scrypt.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

const password = utf8ToBytes("All World isolated Worker KDF benchmark — äöü 🔐");
const salt = Uint8Array.from({ length: 16 }, (_, index) => index);

const candidates = {
  "32": { name: "OWASP 32 MiB", N: 2 ** 15, r: 8, p: 3 },
  "64": { name: "OWASP 64 MiB", N: 2 ** 16, r: 8, p: 2 }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function toHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "all-world-auth-kdf-benchmark" });
    }

    if (request.method !== "POST" || url.pathname !== "/benchmark") {
      return json({ error: "Not found" }, 404);
    }

    const candidateKey = url.searchParams.get("candidate");
    if (!Object.hasOwn(candidates, candidateKey)) {
      return json({ error: "Unsupported benchmark candidate" }, 400);
    }
    const candidate = candidates[candidateKey];

    const targetMemoryBytes = 128 * candidate.r * (candidate.N + candidate.p + 1);
    const started = performance.now();

    try {
      const derived = await scryptAsync(password, salt, {
        N: candidate.N,
        r: candidate.r,
        p: candidate.p,
        dkLen: 32,
        maxmem: targetMemoryBytes + 1024 * 1024
      });

      return json({
        ok: true,
        candidate: candidate.name,
        N: candidate.N,
        r: candidate.r,
        p: candidate.p,
        targetMemoryBytes,
        elapsedMs: Number((performance.now() - started).toFixed(2)),
        derivedBytes: derived.length,
        derivedKeyHex: toHex(derived)
      });
    } catch (error) {
      return json({
        ok: false,
        candidate: candidate.name,
        error: String(error && error.message || error).slice(0, 200),
        elapsedMs: Number((performance.now() - started).toFixed(2))
      }, 500);
    }
  }
};
