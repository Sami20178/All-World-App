# Cloudflare Auth API

This directory contains a separate Cloudflare Workers + D1 implementation for All World account endpoints. It is deliberately separate from the existing MCP Worker and from the Node.js server so that neither current service is overwritten.

## Included now

- Registration with username, required email, and password; login by username or email. The required-email rule and OAuth callback fix are merged in server main commit `0202ccbd1b6263e6c8cea40a52c67cdaaa24755f`; the live Worker has not yet been redeployed to that commit.
- PBKDF2-HMAC-SHA-256 password hashes using a per-user random salt.
- Persistent D1 sessions stored as token hashes; cookies are HttpOnly, Secure, and SameSite=None.
- Exact HTTPS Origin checks for state-changing requests, credentialed CORS, request-size validation, and persistent rate limits.
- Account listing/linking/switching, account data CRUD, logout, and account deletion with password confirmation.
- A D1 schema that can be applied repeatedly without deleting existing rows.

## Social sign-in (OAuth 2.0)

The Worker supports a configurable OAuth 2.0 authorization-code flow for providers that expose an HTTPS token endpoint and an HTTPS user-info endpoint. Configure `OAUTH_PROVIDERS_JSON` as a Cloudflare Worker secret; each entry needs `clientId`, `clientSecret`, `authorizeUrl`, `tokenUrl`, and `userInfoUrl`. Optional fields include `label`, `scopes`, `idField`, `nameField`, `userInfoPath`, `emailVerifiedField`, `clientAuthMethod` (`body` or `basic`), `clientIdHeader`, `pkce: true`, and `extraAuthorizeParams`. Use PKCE (S256) whenever the provider supports it. Register the exact callback URL `https://YOUR-API-HOST/api/auth/oauth/PROVIDER/callback` with each provider.

The Worker only lists providers with valid server-side configuration. It does not advertise `apple` or `supercell` through this generic adapter; Apple requires a dedicated, verified ID-token implementation before it can be enabled. OAuth state is single-use, expires after ten minutes, is bound to an HttpOnly/Secure browser cookie, and is checked before exchanging the code. Provider secrets are never returned to the browser or stored in Git. Email is only copied to a new account when the configured profile field explicitly marks it verified; an existing email account is never auto-linked.

Email verification and password reset are still not implemented in this Worker. As of 2026-11-01, the production frontend is configured to use this Worker. GitHub Actions live smoke test #41339823563 verified `/api/health`, `/api/ready`, and `/api/auth/providers` over HTTPS; provider discovery returned zero configured providers. The test was read-only and did not create an account or exercise a browser registration/login flow. Do not claim complete authentication until those end-to-end tests pass.

## Configuration

The production deployment uses the dedicated D1 database all-world-auth bound as AUTH_DB. APP_ORIGIN is set to the exact HTTPS origin of the public All World frontend. RATE_LIMIT_SECRET is a Cloudflare secret binding with a random value of at least 32 characters; it HMACs rate-limit keys so raw IP addresses are not stored. Do not reuse the existing OAUTH_DB used by the MCP service. Keep credentials and any future provider secrets in Cloudflare secret bindings, never in Git.

The Worker code initializes tables with CREATE TABLE IF NOT EXISTS; schema.sql is also provided for review and explicit migrations. The test uses a local SQLite adapter to exercise the Worker request handler without modifying production data.

## Endpoints

GET /api/health and GET /api/ready
GET /api/auth/providers
GET /api/auth/oauth/:provider
GET /api/auth/oauth/:provider/callback
POST /api/auth/register
POST /api/auth/login
GET /api/auth/me
POST /api/auth/logout
GET /api/auth/linked
POST /api/auth/link
POST /api/auth/switch
GET /api/account
GET, POST /api/account/data
PUT, DELETE /api/account/data/:id
DELETE /api/account

The frontend currently uses `https://all-world-auth-api.docc-samisoliman.workers.dev`. The health/readiness/provider-discovery endpoints have passed an external HTTPS smoke test, but registration, login, logout, session restoration, and account management still require browser end-to-end verification.


## Live deployment audit (2026-11-01)

- Active Worker: `all-world-auth-api`; latest listed deployment version `91b33834-5905-4c5f-855b-35c6fd5339ad`, 100% traffic.
- Bindings verified by name/type: `APP_ORIGIN`, `AUTH_DB` (D1), and secret binding `RATE_LIMIT_SECRET`. Secret values were not read.
- `OAUTH_PROVIDERS_JSON` is not configured. Live provider discovery returns zero providers.
- Read-only D1 SQL inspection confirmed the application tables `users`, `sessions`, `account_links`, `user_data`, `auth_rate_limits`, `oauth_identities`, and `oauth_states`. No `email_verified`, verification-token, or password-reset-token table is present.
- No email-sending service binding is configured. Email verification and password reset remain unimplemented.
- The frontend health/readiness/provider-discovery smoke test is not a full registration/login/logout test. No production account was created or changed.
- The separate Node.js server in the repository is not the API URL currently selected by the frontend.

## Preview safety

- The root `wrangler.jsonc` belongs to the separate MCP Worker `all-world-app`. It binds `OAUTH_DB` to `all-world-mcp-oauth`; its `all-world-mcp-oauth-preview` preview binding is for MCP OAuth only.
- That file is **not** an Auth Worker preview configuration. The production `all-world-auth-api` currently binds `AUTH_DB` to the production `all-world-auth` D1 database. No dedicated `all-world-auth-preview` database or Auth Worker preview binding was found in this audit.
- Do not use the MCP preview database as a substitute. Do not run `wrangler preview` or `wrangler deploy` for this Auth Worker until a dedicated `cloudflare-auth/wrangler.jsonc` and isolated D1 preview database are created and verified.
- The production Worker bindings are `APP_ORIGIN`, `AUTH_DB` (D1), and `RATE_LIMIT_SECRET` (secret text). The secret value was not read. Any future preview must use synthetic data and a distinct preview secret; no production accounts or data belong in preview.


## Post-merge audit (2026-11-02)

- Server main commit: [0202ccbd1b6263e6c8cea40a52c67cdaaa24755f](https://github.com/Sami20178/All-World-App/commit/0202ccbd1b6263e6c8cea40a52c67cdaaa24755f). It requires a valid email for new Cloudflare Worker registrations and includes the OAuth callback scope fix.
- Main-branch checks passed: [API CI #41499443072](https://github.com/Sami20178/All-World-App/actions/runs/41499443072), [read-only API/OAuth smoke #41499443214](https://github.com/Sami20178/All-World-App/actions/runs/41499443214), [Node validation #41499443230](https://github.com/Sami20178/All-World-App/actions/runs/41499443230), and [Worker validation #41499443084](https://github.com/Sami20178/All-World-App/actions/runs/41499443084).
- Cloudflare still lists production deployment `48823a4b-9ffd-47ff-be23-6070cc853fdf`, version `91b33834-5905-4c5f-855b-35c6fd5339ad`, at 100% traffic (created 2026-10-31). The merged source change is therefore **not yet live**.
- The latest live smoke test verified `/api/health`, `/api/ready`, and provider discovery. It reported zero configured providers and did not create or change an account.
- No `OAUTH_PROVIDERS_JSON` binding or email-delivery service is configured. Email verification and password reset remain unavailable; Google, Apple, Microsoft, GitHub, and Roblox are not live sign-in options. Supercell remains excluded.
- The production D1 schema was inspected read-only. It has no `email_verified` field or verification/reset-token tables. No production account, password, token, or database row was changed.


## Isolierte Auth-Preview (02.11.2026)

Die Preview ist bewusst ein eigener Worker und eine eigene D1-Datenbank. Sie verwendet **nicht** die Produktionsdatenbank und akzeptiert nur den Test-Origin `https://auth-preview.invalid`. Das Frontend bleibt auf der Produktions-API; es wird keine Produktionskonfiguration geändert.

| Ressource | Preview-Wert |
|---|---|
| Worker | `all-world-auth-api-preview` |
| D1 | `all-world-auth-preview` |
| D1-ID | `79a0bdac-004d-4fde-becf-d9beb1fc31e5` |
| Region / Jurisdiction | EU / EEUR |
| App-Origin | `https://auth-preview.invalid` |
| API-Origin | `https://all-world-auth-api-preview.docc-samisoliman.workers.dev` |

Die Konfiguration liegt in [`wrangler.preview.jsonc`](./wrangler.preview.jsonc). Sie enthält ausschließlich die Preview-D1-Bindung. `RATE_LIMIT_SECRET` wird als Cloudflare-Secret-Binding gesetzt; sein Wert gehört weder in Git noch in Logs. `OAUTH_PROVIDERS_JSON` bleibt ungesetzt, solange kein Anbieter vollständig eingerichtet und getestet wurde.

### Aktueller Preview-Status (02.11.2026)

- Die isolierte EU-D1-Datenbank wurde angelegt: `all-world-auth-preview` (`79a0bdac-004d-4fde-becf-d9beb1fc31e5`).
- Der Preview-Worker `all-world-auth-api-preview` wurde in diesem Durchlauf **nicht** bereitgestellt. Die Worker-Liste bestätigt, dass der Script-Name noch nicht existiert.
- Deshalb sind Preview-URL, Schema-Initialisierung und Live-E2E noch **nicht bestätigt**. Der manuelle Smoke-Job bleibt absichtlich deaktiviert, bis der Worker und sein eigenes `RATE_LIMIT_SECRET`-Binding tatsächlich bereitstehen.
- Die Produktionsressourcen `all-world-auth-api` und `all-world-auth` wurden nicht verändert. Das Produktions-Frontend bleibt unverändert verbunden.

## Preview bereitstellen

1. Das Worker-Skript aus diesem Verzeichnis mit der Preview-Konfiguration bereitstellen:
   `npx wrangler@4 deploy --config cloudflare-auth/wrangler.preview.jsonc`
2. Für den Preview-Worker ein eigenes zufälliges Secret namens `RATE_LIMIT_SECRET` als Secret-Binding hinterlegen. Niemals den Produktionswert wiederverwenden.
3. Die Preview-Suite ausführen: `node cloudflare-auth/tests/preview-smoke.mjs`.
4. Nur synthetische Testdaten verwenden. Der Test erstellt ein Konto und löscht es am Ende wieder. Bei einem abgebrochenen Lauf können ausschließlich synthetische Preview-Daten zurückbleiben.
5. Der Smoke-Test prüft außerdem die Session-Cookie-Attribute `HttpOnly`, `Secure` und `SameSite=None` für den Cross-Origin-Frontend-Aufruf.

Der GitHub-CI-Workflow prüft die Konfiguration per Wrangler-Dry-Run. Der Live-Preview-Test wird ausschließlich manuell über `workflow_dispatch` auf `main` gestartet, nachdem der Preview-Worker tatsächlich bereitgestellt wurde; Pull-Request- und normale Push-Läufe greifen nicht auf die Preview-API zu.

**Produktionsschutz:** Diese Datei enthält absichtlich keinen Produktions-Worker-Namen, keine Produktions-D1-ID und keine Produktions-Secret-Werte. Ein Preview-Deployment darf niemals mit dem MCP-Worker `all-world-app` oder dessen `OAUTH_DB` verbunden werden.


## Preview-Worker-Staging – 2026-11-03 (Nachprüfung)

### Cloudflare-Konfiguration – tatsächlich geprüft

- Der isolierte Worker `all-world-auth-api-preview` ist vorhanden. Die aktuelle Cloudflare-Deployment-Liste meldet Deployment `b43e809b-7ee0-4300-bf69-8422190d6132`, Version `0461dcc0-caab-4b9a-9a8f-a3f9e839b12d`, mit 100 % Traffic.
- Die Preview-Bindings wurden nach Namen und Typ geprüft: `API_PUBLIC_URL`, `APP_ORIGIN`, `AUTH_DB` (D1 `all-world-auth-preview`) und `RATE_LIMIT_SECRET` (Secret Text). Der Secret-Wert wurde nicht gelesen oder dokumentiert.
- Das eigene `RATE_LIMIT_SECRET` wurde ausschließlich am Preview-Worker gesetzt. Produktions-Secret, Produktions-Worker und MCP-Worker wurden nicht verändert.
- Eine schreibgeschützte D1-Abfrage vor dem ersten Health-Aufruf zeigte nur die interne Tabelle `_cf_KV`; die Anwendungstabellen waren noch nicht initialisiert. Der Worker führt `CREATE TABLE IF NOT EXISTS` beim ersten Health-/API-Aufruf aus. Es wurde kein SQL-Reset und keine Datenlöschung ausgeführt.

### Korrektur nach erstem Preview-Lauf – 03.11.2026

- Der erste GitHub-Preview-Smoke-Lauf [#41701236174](https://github.com/Sami20178/All-World-App/actions/runs/41701236174) bestand die lokale Worker-Validierung, scheiterte aber beim ersten HTTPS-Health-Aufruf. Die anschließende Cloudflare-Prüfung zeigte als Ursache: Das workers.dev-Subdomain-Flag des Preview-Skripts war deaktiviert (`enabled=false`).
- Ausschließlich für `all-world-auth-api-preview` wurde das Subdomain-Flag auf `enabled=true` gesetzt; `previews_enabled=false` blieb erhalten. Der anschließende GET-Read-back bestätigte genau diese Werte. Der Produktions-Worker wurde nicht geändert.
- Das separate Preview-Secret `RATE_LIMIT_SECRET` ist als `secret_text` vorhanden. Der Wert wurde nicht gelesen, nicht protokolliert und nicht in Git gespeichert.
- Der nächste Smoke-Lauf muss nach dieser Korrektur erneut bestätigen, dass Health/Readiness, Schema-Initialisierung und die synthetischen Account-Tests funktionieren. Bis dahin ist die Preview **konfiguriert, aber nicht E2E-bestätigt**.

### Nächster End-to-End-Test

- `cloudflare-auth/tests/preview-smoke.mjs` prüft Health, Readiness, anonyme Zugriffssperre, synthetische Registrierung, E-Mail-Login, Session-Wiederherstellung und -Rotation, falsches Passwort, Logout und Kontolöschung.
- Der Test verwendet ausschließlich `example.test`-Daten und löscht das synthetische Konto am Ende. Er ist noch **nicht** als erfolgreich ausgeführt bestätigt.
- Die GitHub-Actions-Verbindung stellt keinen Workflow-Dispatch-Aufruf bereit. Deshalb wird `cloudflare-auth-ci.yml` so angepasst, dass der Preview-Smoke nach erfolgreicher Validierung auch bei einem Main-Push mit Änderungen unter `cloudflare-auth/**` ausgeführt wird; manuelles `workflow_dispatch` bleibt möglich. Pull-Request-Läufe greifen nicht auf die Preview-API zu.
- Direkte HTTP-Abrufe aus der aktuellen Ausführungsumgebung scheiterten an DNS-Auflösung. Der maßgebliche E2E-Nachweis muss daher aus dem GitHub-Runner stammen.

### Produktion bleibt getrennt

- Produktions-Worker `all-world-auth-api`: Deployment `48823a4b-9ffd-47ff-be23-6070cc853fdf`, Version `91b33834-5905-4c5f-855b-35c6fd5339ad`, 100 % Traffic. Dieser Worker wurde in diesem Durchlauf nicht verändert.
- Produktions-D1 `all-world-auth` wurde nur lesend geprüft; sieben Anwendungstabellen sind vorhanden. Es wurden keine Nutzerkonten, Passwörter oder Produktionszeilen verändert.
- `OAUTH_PROVIDERS_JSON` ist nicht konfiguriert; Provider-Discovery meldete zuletzt null aktive Anbieter. E-Mail-Versand, E-Mail-Verifizierung und Passwortzurücksetzung bleiben offen.
- Google, Apple, Microsoft, GitHub und Roblox sind nicht als live aktiviert bestätigt. Supercell bleibt ausgeschlossen.
