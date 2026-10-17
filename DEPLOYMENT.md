# All World API — deployment

This repository now includes a Docker image and a Docker Compose service. It does not automatically publish the service to the internet: run it on a host you control and place an HTTPS reverse proxy in front of it.

## 1. Prepare the host

- Install Docker Engine and the Docker Compose plugin.
- Use a supported Node 22 base image (the Dockerfile supplies it).
- Point a domain's HTTPS reverse proxy to `http://127.0.0.1:3000`.
- Keep the Docker host and its persistent storage updated and backed up.

## 2. Configure production environment

Copy `.env.example` to `.env`, then edit `.env` on the host. Do not commit or share this file.

Required values:
- `NODE_ENV=production`
- `APP_ORIGIN=https://YOUR-FRONTEND-DOMAIN` — exact origin only, no path or trailing slash.
- `SESSION_SECRET` — generate a unique random value with at least 32 characters. Do not use the example value.
- `COOKIE_SAME_SITE=none` for a frontend and API on different sites; production cookies are Secure and require HTTPS.
- `API_PUBLIC_URL=https://YOUR-API-DOMAIN` if using external sign-in. Use the exact API origin without a path.
- `OAUTH_PROVIDERS_JSON` — optional JSON with provider credentials. Keep all client secrets and the Apple private key only in the server environment.

The server now refuses production startup with an obvious placeholder session secret or a non-HTTPS frontend origin. OAuth provider URLs must use HTTPS in production.

## 3. Build and start

From the backend repository directory, after editing `.env`:

```sh
docker compose -f compose.yaml config
docker compose -f compose.yaml up -d --build
docker compose -f compose.yaml ps
docker compose -f compose.yaml logs --tail=100 all-world-api
```

Check the health endpoint on the host:

```sh
curl http://127.0.0.1:3000/api/health
```

Expected JSON includes `"ok":true`. The service binds only to loopback on the host; expose it publicly only through the HTTPS reverse proxy. Configure the proxy to preserve the original HTTPS connection information so Express can set Secure cookies correctly.

## 4. Persistent database and backups

SQLite data lives in the named Docker volume `all-world-data` mounted at `/app/data`. Do not delete this volume when updating the container. Back it up using a SQLite-aware backup procedure or a stopped-service copy; test restores periodically. Container images do not contain the database or `.env`.

## 5. Configure external identity providers

For each provider, register this exact callback URL using your actual API domain:

`https://YOUR-API-DOMAIN/api/auth/oauth/PROVIDER/callback`

Replace `PROVIDER` with the lowercase provider ID, such as `roblox`, `x`, `apple`, `google`, `github`, `discord`, `spotify`, `gitlab`, or `twitch`. Copy provider credentials into `OAUTH_PROVIDERS_JSON` on the server only. Set `"pkce":true` for Roblox and X. Apple uses `clientId` (Services ID), `teamId`, `keyId`, and `privateKey`; its private key must never be committed.

Supercell ID remains disabled because there is no documented, general-purpose compatible OAuth flow implemented here. Do not enter game credentials into this API.

## 6. Configure the frontend

Set `window.ALL_WORLD_API_URL = "https://YOUR-API-DOMAIN"` before loading `app.js` in the frontend deployment. Configure the API's `APP_ORIGIN` to that exact frontend origin. Both domains must use HTTPS when the frontend and API are cross-site.

## 7. Validate before real users

- Run `npm install`, `npm run check`, and `npm test` in the backend repository.
- Confirm the container health check passes.
- Test register/login/logout, account deletion, and each configured provider using real provider test accounts.
- Confirm HTTPS, Secure cookies, CORS origin, database persistence, backup restoration, and secret handling.
- These instructions do not claim the service has been deployed or that live third-party sign-ins have been tested.
