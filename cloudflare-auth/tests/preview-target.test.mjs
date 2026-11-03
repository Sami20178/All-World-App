import test from "node:test";
import assert from "node:assert/strict";
import { PREVIEW_BASE_URL, resolvePreviewBase } from "../preview-target.mjs";

test("defaults to the dedicated auth preview Worker", () => {
  assert.equal(resolvePreviewBase(), PREVIEW_BASE_URL);
});

test("accepts the exact HTTPS preview origin with a trailing slash", () => {
  assert.equal(resolvePreviewBase(PREVIEW_BASE_URL + "/"), PREVIEW_BASE_URL);
});

test("refuses the production auth Worker", () => {
  assert.throws(
    () => resolvePreviewBase("https://all-world-auth-api.docc-samisoliman.workers.dev"),
    /target must be exactly/
  );
});

test("rejects malformed preview URLs before making any request", () => {
  assert.throws(() => resolvePreviewBase("not a URL"), /dedicated preview Worker URL/);
});

test("refuses other hosts, HTTP, ports, credentials, paths, queries and fragments", () => {
  const invalidTargets = [
    "http://all-world-auth-api-preview.docc-samisoliman.workers.dev",
    "https://example.com",
    "https://user:pass@all-world-auth-api-preview.docc-samisoliman.workers.dev",
    "https://all-world-auth-api-preview.docc-samisoliman.workers.dev:8443",
    "https://all-world-auth-api-preview.docc-samisoliman.workers.dev/path",
    "https://all-world-auth-api-preview.docc-samisoliman.workers.dev/?target=production",
    "https://all-world-auth-api-preview.docc-samisoliman.workers.dev/#fragment"
  ];
  for (const target of invalidTargets) {
    assert.throws(() => resolvePreviewBase(target), /target must be exactly/);
  }
});
