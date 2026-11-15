const MAILER_URL = "https://mailer.internal/send";
const MAILER_CONTRACT = "all-world-auth-email-v1";
const MAX_PAYLOAD_BYTES = 16 * 1024;
const EMAIL_PATTERN = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function isSameOriginHttpsUrl(value, appOrigin) {
  try {
    const target = new URL(value);
    const origin = new URL(appOrigin);
    return target.protocol === "https:" &&
      origin.protocol === "https:" &&
      target.origin === origin.origin &&
      !target.username && !target.password &&
      !target.hash;
  } catch {
    return false;
  }
}

export function hasEmailSender(env) {
  return Boolean(env?.EMAIL_SENDER && typeof env.EMAIL_SENDER.fetch === "function");
}

function buildMessage(env, { type, to, username, url }) {
  if (!hasEmailSender(env)) return null;
  if (!EMAIL_PATTERN.test(String(to || "")) || String(to).length > 254) return null;
  if (!isSameOriginHttpsUrl(url, env.APP_ORIGIN)) return null;
  if (typeof username !== "string" || username.length > 32) return null;

  const safeName = username ? escapeHtml(username) : "";
  const greetingText = username ? `Hallo ${username},` : "Hallo,";
  const greetingHtml = username ? `Hallo ${safeName},` : "Hallo,";
  const safeUrl = escapeHtml(url);

  if (type === "verification") {
    return {
      version: 1,
      action: "deliver",
      type,
      to,
      subject: "Bestätige deine All World E-Mail-Adresse",
      text: `${greetingText}\\n\\nBitte bestätige deine E-Mail-Adresse über diesen sicheren Link:\\n${url}\\n\\nDer Link ist nur einmal verwendbar und läuft zeitnah ab. Wenn du kein Konto erstellt hast, kannst du diese Nachricht ignorieren.`,
      html: `<p>${greetingHtml}</p><p>Bitte bestätige deine E-Mail-Adresse über diesen sicheren Link:</p><p><a href="${safeUrl}">E-Mail-Adresse bestätigen</a></p><p>Der Link ist nur einmal verwendbar und läuft zeitnah ab. Wenn du kein Konto erstellt hast, kannst du diese Nachricht ignorieren.</p>`
    };
  }

  if (type === "password-reset") {
    return {
      version: 1,
      action: "deliver",
      type,
      to,
      subject: "Setze dein All World Passwort zurück",
      text: `${greetingText}\\n\\nDu kannst dein Passwort über diesen sicheren Link zurücksetzen:\\n${url}\\n\\nDer Link ist nur einmal verwendbar und läuft zeitnah ab. Wenn du die Zurücksetzung nicht angefordert hast, kannst du diese Nachricht ignorieren.`,
      html: `<p>${greetingHtml}</p><p>Du kannst dein Passwort über diesen sicheren Link zurücksetzen:</p><p><a href="${safeUrl}">Passwort zurücksetzen</a></p><p>Der Link ist nur einmal verwendbar und läuft zeitnah ab. Wenn du die Zurücksetzung nicht angefordert hast, kannst du diese Nachricht ignorieren.</p>`
    };
  }

  return null;
}

async function sendToMailer(env, payload) {
  const serialized = JSON.stringify(payload);
  if (new TextEncoder().encode(serialized).length > MAX_PAYLOAD_BYTES) {
    return { queued: false, reason: "invalid_message" };
  }

  try {
    const response = await env.EMAIL_SENDER.fetch(new Request(MAILER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-All-World-Mailer-Contract": MAILER_CONTRACT
      },
      body: serialized
    }));
    return response?.status === 202
      ? { queued: true }
      : { queued: false, reason: "delivery_failed" };
  } catch {
    return { queued: false, reason: "delivery_failed" };
  }
}

export async function enqueueAuthEmail(env, message) {
  if (!hasEmailSender(env)) return { queued: false, reason: "not_configured" };
  const payload = buildMessage(env, message || {});
  if (!payload) return { queued: false, reason: "invalid_message" };
  return sendToMailer(env, payload);
}

export async function enqueueSuppressedAuthEmail(env) {
  if (!hasEmailSender(env)) return { queued: false, reason: "not_configured" };
  return sendToMailer(env, { version: 1, action: "suppress" });
}
