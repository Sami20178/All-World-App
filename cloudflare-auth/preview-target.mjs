export const PREVIEW_BASE_URL = "https://all-world-auth-api-preview.docc-samisoliman.workers.dev";
const PREVIEW_HOST = new URL(PREVIEW_BASE_URL).hostname;

export function resolvePreviewBase(configured = PREVIEW_BASE_URL) {
  let target;
  try {
    target = new URL(configured);
  } catch {
    throw new Error("Refusing auth preview smoke test: AUTH_PREVIEW_BASE_URL must be the dedicated preview Worker URL.");
  }

  if (
    target.protocol !== "https:" ||
    target.hostname !== PREVIEW_HOST ||
    target.port !== "" ||
    target.username !== "" ||
    target.password !== "" ||
    target.pathname !== "/" ||
    target.search !== "" ||
    target.hash !== ""
  ) {
    throw new Error("Refusing auth preview smoke test: target must be exactly " + PREVIEW_BASE_URL + ".");
  }

  return target.origin;
}
