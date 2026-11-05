import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import benchmarkWorker from "../scrypt-benchmark-worker.mjs";
import { utf8ToBytes } from "@noble/hashes/utils.js";

const salt = Uint8Array.from({ length: 16 }, (_, index) => index);
const password = utf8ToBytes("All World KDF test — äöü 🔐");

async function derive(input, options) {
  const requiredMemory = 128 * options.r * (options.N + options.p + 1);
  return scryptAsync(input, salt, {
    ...options,
    dkLen: 32,
    maxmem: requiredMemory + 1024 * 1024
  });
}

test("scrypt matches the RFC 7914 small reference vector", async () => {
  const actual = await scryptAsync(new Uint8Array(0), new Uint8Array(0), {
    N: 16,
    r: 1,
    p: 1,
    dkLen: 64,
    maxmem: 128 * (16 + 1 + 1) + 1024
  });
  assert.equal(
    Buffer.from(actual).toString("hex"),
    "77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906"
  );
});

test("scrypt keeps Unicode password inputs distinct", async () => {
  const options = { N: 2 ** 12, r: 8, p: 1 };
  const first = await derive(password, options);
  const second = await derive(utf8ToBytes("All World KDF test — äöü 🔑"), options);
  assert.equal(first.length, 32);
  assert.notDeepEqual(first, second);
});

for (const candidate of [
  { name: "OWASP 64 MiB", N: 2 ** 16, r: 8, p: 2 },
  { name: "OWASP 32 MiB", N: 2 ** 15, r: 8, p: 3 }
]) {
  test("benchmark scrypt candidate: " + candidate.name, async () => {
    const rssBefore = process.memoryUsage().rss;
    const started = performance.now();
    const derived = await derive(password, candidate);
    const elapsedMs = performance.now() - started;
    const rssDelta = process.memoryUsage().rss - rssBefore;

    assert.equal(derived.length, 32);
    console.log(
      "KDF_BENCHMARK " +
      JSON.stringify({
        candidate: candidate.name,
        N: candidate.N,
        r: candidate.r,
        p: candidate.p,
        targetMemoryBytes: 128 * candidate.r * (candidate.N + candidate.p + 1),
        elapsedMs: Number(elapsedMs.toFixed(2)),
        processRssDeltaBytes: rssDelta
      })
    );
  });
}

test("rejects inherited and unsupported benchmark candidate keys with 400", async () => {
  for (const candidate of ["constructor", "toString", "__proto__", "not-a-candidate"]) {
    const response = await benchmarkWorker.fetch(
      new Request("https://benchmark.invalid/benchmark?candidate=" + encodeURIComponent(candidate), {
        method: "POST"
      })
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Unsupported benchmark candidate"
    });
  }
});
