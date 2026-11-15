import test from "node:test";
import assert from "node:assert/strict";
import {
  enqueueAuthEmail,
  enqueueSuppressedAuthEmail,
  hasEmailSender
} from "../email-sender.mjs";

const APP_ORIGIN = "https://app.example.test";

function fakeMailer(status = 202) {
  const calls = [];
  return {
    calls,
    binding: {
      async fetch(request) {
        calls.push({
          url: request.url,
          method: request.method,
          headers: new Headers(request.headers),
          body: await request.json()
        });
        return new Response(null, { status });
      }
    }
  };
}

function env(EMAIL_SENDER) {
  return { APP_ORIGIN, ...(EMAIL_SENDER ? { EMAIL_SENDER } : {}) };
}

test("does not report an email sender when the service binding is absent", async () => {
  const bindings = env();
  assert.equal(hasEmailSender(bindings), false);
  assert.deepEqual(await enqueueAuthEmail(bindings, {
    type: "verification",
    to: "user@example.test",
    username: "user",
    url: APP_ORIGIN + "/account/verify?token=opaque"
  }), { queued: false, reason: "not_configured" });
  assert.deepEqual(await enqueueSuppressedAuthEmail(bindings), {
    queued: false,
    reason: "not_configured"
  });
});

test("queues a verification message through the private service binding", async () => {
  const mailer = fakeMailer();
  const result = await enqueueAuthEmail(env(mailer.binding), {
    type: "verification",
    to: "user@example.test",
    username: "<Sam> & Co",
    url: APP_ORIGIN + "/account/verify?token=opaque-token"
  });

  assert.deepEqual(result, { queued: true });
  assert.equal(mailer.calls.length, 1);
  const call = mailer.calls[0];
  assert.equal(call.url, "https://mailer.internal/send");
  assert.equal(call.method, "POST");
  assert.equal(call.headers.get("X-All-World-Mailer-Contract"), "all-world-auth-email-v1");
  assert.equal(call.body.version, 1);
  assert.equal(call.body.action, "deliver");
  assert.equal(call.body.type, "verification");
  assert.equal(call.body.to, "user@example.test");
  assert.match(call.body.html, /&lt;Sam&gt; &amp; Co/);
  assert.match(call.body.text, /https:\/\/app\.example\.test\/account\/verify\?token=opaque-token/);
  assert.equal(JSON.stringify(result).includes("opaque-token"), false);
});

test("queues a password-reset message with a fixed subject and same-origin HTTPS link", async () => {
  const mailer = fakeMailer();
  const result = await enqueueAuthEmail(env(mailer.binding), {
    type: "password-reset",
    to: "user@example.test",
    username: "User",
    url: APP_ORIGIN + "/account/reset-password?token=reset-token"
  });

  assert.deepEqual(result, { queued: true });
  assert.equal(mailer.calls[0].body.subject, "Setze dein All World Passwort zurück");
  assert.equal(mailer.calls[0].body.type, "password-reset");
  assert.match(mailer.calls[0].body.text, /reset-password/);
});

test("rejects invalid recipients, unknown message types, and unsafe links before calling the mailer", async () => {
  const mailer = fakeMailer();
  const bindings = env(mailer.binding);
  const base = {
    type: "verification",
    to: "user@example.test",
    username: "User",
    url: APP_ORIGIN + "/account/verify?token=opaque"
  };

  for (const invalid of [
    { ...base, to: "not-an-email" },
    { ...base, to: 12345 },
    { ...base, url: APP_ORIGIN + "/" + "x".repeat(2050) },
    { ...base, username: "bad\nname" },
    { ...base, type: "marketing" },
    { ...base, url: "http://app.example.test/account/verify" },
    { ...base, url: "https://evil.example/account/verify" },
    { ...base, url: "https://user:pass@app.example.test/account/verify" },
    { ...base, url: "https://app.example.test/account/verify#token" },
    { ...base, username: "x".repeat(33) }
  ]) {
    assert.deepEqual(await enqueueAuthEmail(bindings, invalid), {
      queued: false,
      reason: "invalid_message"
    });
  }
  assert.equal(mailer.calls.length, 0);
});

test("uses a recipient-free suppression request for unknown-account flows", async () => {
  const mailer = fakeMailer();
  const result = await enqueueSuppressedAuthEmail(env(mailer.binding));
  assert.deepEqual(result, { queued: true });
  assert.deepEqual(mailer.calls[0].body, { version: 1, action: "suppress" });
  assert.equal("to" in mailer.calls[0].body, false);
});

test("does not expose downstream mailer response details", async () => {
  const failing = fakeMailer(503);
  const result = await enqueueAuthEmail(env(failing.binding), {
    type: "verification",
    to: "user@example.test",
    username: "User",
    url: APP_ORIGIN + "/account/verify?token=opaque"
  });
  assert.deepEqual(result, { queued: false, reason: "delivery_failed" });
});
