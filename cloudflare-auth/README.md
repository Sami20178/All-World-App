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

- Nach dem zweiten Lauf war der HTTPS-Health-/Readiness-Aufruf erfolgreich, die Registrierung antwortete jedoch mit HTTP 500. Der Test hat keine erfolgreiche Registrierung bestätigt.
- Für den Preview-Worker wurde danach Cloudflare-Observability aktiviert: Logs und Invocation-Logs mit 100-%-Sampling, Real-time Issues aktiviert und Query-Strings in Logs/Traces redigiert. Diese Einstellung gilt nur für `all-world-auth-api-preview`.
- Der Worker protokolliert im Fehlerpfad ausschließlich Methode, Pfad, interne Stage und Fehlertext/Stack; Request-Bodies, Passwörter und Session-Cookies werden dort nicht protokolliert. Die nächste Preview-Ausführung soll die Ursache anhand dieser Logs eingrenzen.
- `preview-smoke.mjs` gibt bei fehlgeschlagener Registrierung jetzt zusätzlich den begrenzten, nicht geheimen JSON-Fehlertext aus. Das erleichtert die Diagnose, ohne Zugangsdaten zu protokollieren.

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

## Verifizierte Preview-Nachprüfung – 03.11.2026, 20:36 CET

### Aktiver isolierter Preview-Worker

- Cloudflare listet `all-world-auth-api-preview` mit aktivem Deployment `7e27bbe2-b0e8-4aba-afbc-7d51f36fef11`, Version `00362d75-79ff-4e4a-affa-66ae8d73a3f9`, 100 % Traffic. Der Worker wurde am 03.11.2026 um 19:36:40 UTC bereitgestellt.
- Die Deployment-Metadaten ordnen die Version PR [#18](https://github.com/Sami20178/All-World-App/pull/18), Commit `dec0ad1b214379b7443337185ecc177fc9009c88`, zu.
- Die Bindings wurden ausschließlich nach Namen und Typ gelesen: `API_PUBLIC_URL`, `APP_ORIGIN` (`https://auth-preview.invalid`), `AUTH_DB` (die separate EU-D1 `all-world-auth-preview`), `PASSWORD_PEPPER` und `RATE_LIMIT_SECRET`. Beide Secret-Bindings sind vorhanden; ihre Werte wurden nicht gelesen.
- Die Preview-Subdomain ist aktiviert; `previews_enabled=false` bleibt gesetzt. Produktions-Worker, Produktions-D1, MCP-Worker und DNS wurden nicht verändert.
- Eine schreibgeschützte D1-Abfrage bestätigte sieben Anwendungstabellen plus die interne Tabelle `_cf_KV`. Die geprüften Zähler waren 0 Benutzer, 0 Sitzungen und 0 OAuth-Identitäten; die Abfrage schrieb keine Zeilen.

### Passwort-KDF: klare Freigabegrenze

- Der PR-#18-Kandidat verwendet PBKDF2-HMAC-SHA-512 mit 100.000 Iterationen, zufälligem 16-Byte-Salt, 64-Byte-Ergebnis und einem separaten serverseitigen `PASSWORD_PEPPER`.
- Das behebt die beobachtete Workers-WebCrypto-Grenze von maximal 100.000 PBKDF2-Iterationen, erfüllt aber nicht die aktuelle OWASP-Mindestempfehlung von 220.000 Iterationen für PBKDF2-HMAC-SHA-512. Ein Pepper ersetzt keine ausreichende KDF-Arbeitsstufe.
- Deshalb bleibt der Kandidat ausschließlich Preview-Code und ist **nicht für Produktion freigegeben**. Vor einer Produktionsentscheidung muss eine auf dem tatsächlichen Worker gemessene Argon2id-/scrypt-Variante oder ein geeigneter gehosteter Auth-Dienst bewertet werden.
- Add-on-Prüfung: [`paulmillr/noble-hashes`](https://github.com/paulmillr/noble-hashes) ist MIT-lizenziert, hat keine Laufzeit-Abhängigkeiten und veröffentlichte Version 2.4.0 am 27.08.2026. Das README warnt jedoch, dass die JavaScript-Argon2-Implementierung langsam ist und Argon2 dort nicht vom ursprünglichen Audit abgedeckt wurde; daher nicht ungeprüft übernehmen. [`7Hazard/cf-hash-wasm`](https://github.com/7Hazard/cf-hash-wasm) ist ein Cloudflare-WASM-Fork, aber seit 16.01.2021 unverändert, ohne Releases und mit nicht eindeutig erkannter Lizenz (`NOASSERTION)); daher nicht übernehmen.
- Maßgebliche Vorgaben: [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Cloudflare dokumentiert die Worker-CPU- und Speichergrenzen in den [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/).

### E2E-Nachweis

- Der Main-Workflow [#41702164242](https://github.com/Sami20178/All-World-App/actions/runs/41702164242) hatte einen erfolgreichen `preview-smoke`-Job. Er wurde jedoch am 03.11.2026 um 19:19:18 UTC abgeschlossen und liegt damit **vor** dem oben genannten Preview-Deployment um 19:36:40 UTC.
- Dieser frühere Erfolg bestätigt daher nicht den jetzt aktiven PR-#18-Code. Nach dem Preview-Deployment ist noch ein neuer Smoke-Lauf erforderlich, der Health, Readiness, anonyme Zugriffssperre, Registrierung, E-Mail-Login, Session-Wiederherstellung/-Rotation, falsches Passwort, Logout und Löschung eines synthetischen Kontos gegen genau diese aktive Version prüft.
- Die Produktions-API bleibt auf dem bestehenden Worker `all-world-auth-api` mit Deployment `48823a4b-9ffd-47ff-be23-6070cc853fdf` und Version `91b33834-5905-4c5f-855b-35c6fd5339ad`. Der Preview-Kandidat wurde nicht auf Produktion ausgerollt.

### Weiter offen

- PRs [#17](https://github.com/Sami20178/All-World-App/pull/17) und [#18](https://github.com/Sami20178/All-World-App/pull/18) sind beide Drafts und zeigen aktuell denselben Head-Commit `dec0ad1`; sie sind nicht gemergt. Die Branch-Bezeichnung `scrypt-kdf` beschreibt den derzeitigen PBKDF2-Code nicht korrekt.
- E-Mail-Verifizierung, Passwortzurücksetzung und externe OAuth-Anbieter bleiben unimplementiert bzw. nicht konfiguriert. Kein E-Mail-Versanddienst und keine Provider-Konfiguration sind bestätigt; Provider-Discovery in Produktion meldet 0 Anbieter.

### Nachtest nach dem Preview-KDF-Deployment – 03.11.2026, 20:43 CET

- Nach dem Deployment der Version `00362d75-79ff-4e4a-affa-66ae8d73a3f9` lief [Cloudflare Auth Worker validation #41705723031](https://github.com/Sami20178/All-World-App/actions/runs/41705723031) auf Main erfolgreich durch. Sowohl `validate` als auch `preview-smoke` endeten mit `success`.
- Der Smoke-Log bestätigt: Health, Readiness, anonyme Zugriffssperre, Registrierung, Session-Wiederherstellung, E-Mail-Login, Ablehnung eines falschen Passworts, Session-Rotation, Logout und Kontolöschung.
- Der Test prüft außerdem CORS für den isolierten Test-Origin sowie die Cookie-Attribute `HttpOnly`, `Secure` und `SameSite=None`. Er verwendet ein synthetisches `example.test`-Konto und löscht es am Ende.
- Die anschließende schreibgeschützte D1-Zählabfrage bestätigte 0 Benutzer, 0 Sitzungen und 0 OAuth-Identitäten. Es blieben keine Testkonten zurück.
- Die separaten Main-Läufe [API CI #41705722877](https://github.com/Sami20178/All-World-App/actions/runs/41705722877), [Node server validation #41705722652](https://github.com/Sami20178/All-World-App/actions/runs/41705722652) und [Cloudflare API/OAuth health smoke #41705723094](https://github.com/Sami20178/All-World-App/actions/runs/41705723094) waren ebenfalls erfolgreich.
- **Grenze:** Dies ist ein erfolgreicher isolierter Preview-HTTP-End-to-End-Test, kein Browser-Test auf einem echten Gerät und keine Produktionsfreigabe. Die KDF-Sicherheitsgrenze (100.000 PBKDF2-SHA-512-Iterationen unter OWASP-Empfehlung), fehlende E-Mail-Verifizierung/Passwortzurücksetzung und 0 konfigurierte OAuth-Provider bleiben bestehen. Produktion wurde nicht verändert.



## Current production and preview status — 2026-11-04

- Server main is `5075aad90d7b195cbfa1b387c84702e3d3daad9a`. Node validation [#41891608656](https://github.com/Sami20178/All-World-App/actions/runs/41891608656), API CI [#41891608663](https://github.com/Sami20178/All-World-App/actions/runs/41891608663), and read-only Cloudflare API/Auth/MCP smoke [#41891608677](https://github.com/Sami20178/All-World-App/actions/runs/41891608677) passed. The smoke verifies health/readiness/provider discovery, not a successful production account lifecycle.
- Production Worker remains on deployment `48823a4b-9ffd-47ff-be23-6070cc853fdf`, version `91b33834-5905-4c5f-855b-35c6fd5339ad`, 100% traffic. Its visible bindings are `APP_ORIGIN`, `AUTH_DB`, and `RATE_LIMIT_SECRET`; secret values were not read. No `PASSWORD_PEPPER` or `OAUTH_PROVIDERS_JSON` binding is present.
- Preview Worker remains isolated on deployment `7e27bbe2-b0e8-4aba-afbc-7d51f36fef11`, version `00362d75-79ff-4e4a-affa-66ae8d73a3f9`, with a separate D1 database and `PASSWORD_PEPPER` binding.
- Read-only D1 counts in both production and preview: 0 users, 0 sessions, 0 OAuth identities, 0 OAuth states. No production rows were changed.
- Production provider discovery reports 0 enabled OAuth providers. No transactional mail service is configured; email verification and password reset remain unavailable. Google, Apple, Microsoft, GitHub, and Roblox are not active. Supercell remains excluded.

### KDF decision remains blocked

- The current main Worker source uses PBKDF2-HMAC-SHA-256 with 310,000 iterations. A Cloudflare Worker runtime limit of 100,000 iterations was observed in preview diagnostics; see [Cloudflare workerd issue #1346](https://github.com/cloudflare/workerd/issues/1346). This is a compatibility risk; no destructive production registration test was performed.
- The preview candidate uses PBKDF2-HMAC-SHA-512 with 100,000 iterations and a pepper. It passes the observed runtime limit but is below OWASP's 220,000 PBKDF2-HMAC-SHA-512 recommendation, so it is not production-approved.
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) currently recommends Argon2id (19 MiB, 2 iterations, parallelism 1) or scrypt; PBKDF2-HMAC-SHA-256 requires 600,000 iterations and SHA-512 220,000.

### Add-on assessment

| Project | Verified status | Decision |
|---|---|---|
| [Daninet/hash-wasm](https://github.com/Daninet/hash-wasm) 4.12.0 | MIT text in package and LICENSE; last release 2024-11-19; WASM/Argon2id/Web Worker support; no runtime dependencies; GitHub license detector says NOASSERTION. | Not integrated; maintenance freshness and independent audit need review. |
| [paulmillr/noble-hashes](https://github.com/paulmillr/noble-hashes) 2.4.0 | MIT, updated 2026-09-08, no runtime dependencies; scrypt is in documented audit scope, Argon2 is excluded from the Cure53 audit scope. | Scrypt candidate for an isolated Worker benchmark; no integration yet. |
| [7Hazard/cf-hash-wasm](https://github.com/7Hazard/cf-hash-wasm) | NOASSERTION license status, last commit 2021-01-16, no releases. | Do not use. |

No add-on was installed or copied. Next step: benchmark a maintained scrypt/Argon2id option in an isolated Worker with CPU, memory, DoS, and Unicode tests before changing production hashing.


## Production drift audit (2026-11-09)

The production Worker `all-world-auth-api` was compared with the current `main` source by reading the deployed Worker module through the Cloudflare API. The deployed module differs from the repository in two places:

1. Production contains `authStage = "register.password_hash";` at the OAuth callback's new-account path. That callback function does not have an `authStage` variable in scope; it is declared inside the separate request handler. Reproducing this line in the unit-test branch caused `ReferenceError: authStage is not defined` and the OAuth callback returned `oauth_error=login_failed`. This is a bug, not a valid diagnostic marker. The temporary branch insertion and test instrumentation have been removed; the repository's `main` source does not contain this line.
2. Production's registration check still permits an empty email address. The repository's `main` source already rejects a missing, malformed, or overlong email address.

- Production deployment: `48823a4b-9ffd-47ff-be23-6070cc853fdf`, Worker version `91b33834-5905-4c5f-855b-35c6fd5339ad` (2026-10-31 21:28:10 UTC; 100% traffic).
- Production bindings verified by name/type only: `APP_ORIGIN`, `AUTH_DB` (D1), and `RATE_LIMIT_SECRET`. Secret values were not read. `OAUTH_PROVIDERS_JSON` and a transactional email binding are absent.
- Production D1 was inspected using SELECT-only queries: 7 application tables; 0 users, 0 sessions, 0 OAuth identities, and 0 OAuth states. The `users` table has no `email_verified` column; verification/reset-token tables are absent. No rows were written.
- The live read-only smoke test [#42572805908](https://github.com/Sami20178/All-World-App/actions/runs/42572805908) passed `/api/health`, `/api/ready`, and provider discovery; it reported 0 configured OAuth providers. It did not exercise registration, login, logout, or browser cookies.
- Production still uses PBKDF2-HMAC-SHA-256 with 310,000 iterations. Do not change the KDF as part of this email-validation fix. The separate preview KDF work in PRs [#18](https://github.com/Sami20178/All-World-App/pull/18) and [#19](https://github.com/Sami20178/All-World-App/pull/19) is not a production approval.

**Deployment status:** this is documentation/source tracking only. No production Worker or D1 setting was changed in this audit. The current `main` Worker source contains the stricter email check and no undefined OAuth diagnostic assignment, but production remains on the older deployed module. Before production deployment, use a controlled procedure that preserves the existing bindings and runtime settings, then verify the deployed module and run the read-only live smoke test. Email verification/password reset remain unavailable until a transactional mail service and token schema are implemented. Google, Apple, Microsoft, GitHub, and Roblox remain unconfigured; Supercell remains excluded.


## Production Auth Worker correction and live verification — 2026-11-09

### Deployment

The production Worker was updated from the current repository source after a read-only comparison found two differences in the deployed module: (1) the live OAuth callback contained an out-of-scope `authStage = "register.password_hash";` assignment that could raise a `ReferenceError`, and (2) the live registration guard allowed an empty email address while `main` required a valid email.

- Source: [`cloudflare-auth/worker.mjs` at commit `0202ccbd`](https://github.com/Sami20178/All-World-App/blob/0202ccbd1b6263e6c8cea40a52c67cdaaa24755f/cloudflare-auth/worker.mjs).
- Cloudflare version: `df4737b8-e4b2-44a4-a69a-798a8be2b2d9`.
- Production deployment: `72a69a24-5178-4164-8c13-7af85012e921`, 100% traffic, created 2026-11-09 18:55:23 UTC.
- Post-deploy module read-back matched the GitHub source file exactly. The email guard is required and the out-of-scope callback assignment is absent.
- Existing bindings were preserved: `APP_ORIGIN`, `AUTH_DB`, and `RATE_LIMIT_SECRET`. Secret values were not read or written. The production D1 database was not modified.
- Read-only D1 verification after deployment: 0 users, 0 sessions, 0 OAuth identities, 0 OAuth states; `changed_db=false`, `rows_written=0`.

### Tests

- [Live API/MCP smoke #42675741552](https://github.com/Sami20178/All-World-App/actions/runs/42675741552), attempt 2, passed after deployment. The account-auth checks passed `/api/health`, `/api/ready`, and `/api/auth/providers`; provider discovery returned 0 providers. This test was read-only and created or changed no accounts.
- [Cloudflare Auth Worker validation #42675741140](https://github.com/Sami20178/All-World-App/actions/runs/42675741140) passed. Its isolated preview E2E covered health, readiness, anonymous-route protection, registration, session restoration, email login, invalid-password rejection, session rotation, logout, and account deletion. The preview uses a separate Worker/D1 and PBKDF2-HMAC-SHA-512 at 100,000 iterations; it does **not** prove production registration works with the production KDF.

### Remaining release blockers

- Production hashing remains PBKDF2-HMAC-SHA-256 with 310,000 iterations. A previous isolated Worker test documented a runtime rejection above 100,000 iterations. No production registration/login E2E has been run after this deployment; KDF compatibility remains unverified and must be resolved before declaring account creation complete.
- The remote scrypt/Argon2id benchmark in [draft PR #19](https://github.com/Sami20178/All-World-App/pull/19) has not run because the repository Actions secret `CLOUDFLARE_API_TOKEN` is not configured. `@noble/hashes@2.4.0` remains a test-only/dev dependency, not a production password-hashing implementation.
- No transactional email service or verification/reset-token tables are configured. Email verification and password reset remain unavailable.
- `OAUTH_PROVIDERS_JSON` is not configured; production discovery returns 0 providers. Google, Apple, Microsoft, GitHub, and Roblox are not active sign-in options. Apple requires its own validated OIDC implementation. Supercell remains excluded.
- The Node.js/Express server is a separate component and is not confirmed as the production frontend API; the website points to the Cloudflare Auth Worker.

Do not describe the account system as fully complete until production registration/login/session E2E, the production KDF, email verification/reset, and each actually configured OAuth provider have passed their own tests.


## Production deployment follow-up — 2026-11-09

Cloudflare read-back after the earlier drift audit now shows a new production deployment:

- Worker: `all-world-auth-api`
- Deployment: `72a69a24-5178-4164-8c13-7af85012e921`
- Active version: `df4737b8-e4b2-44a4-a69a-798a8be2b2d9` (100% traffic)
- Created: `2026-11-09T18:55:23Z`
- Version metadata links to server commit `0202ccbd1b6263e6c8cea40a52c67cdaaa24755f` and records the message “Deploy source-main auth fixes: require registration email and remove OAuth callback ReferenceError”.
- Binding names/types were read back only: `APP_ORIGIN` (HTTPS frontend origin), `AUTH_DB` (D1), and `RATE_LIMIT_SECRET` (secret). Secret values were not read. `OAUTH_PROVIDERS_JSON` and a transactional email binding remain absent.

The deployed module read-back contains the required email guard (rejects missing, malformed, or overlong email) and does not contain the previous out-of-scope `authStage = "register.password_hash"` assignment. The callback has its own local diagnostic stage variable. The deployed module still uses PBKDF2-HMAC-SHA-256 with 310,000 iterations.

**Verification boundary:** the deployment and active version were confirmed through Cloudflare's deployment/version API. The successful API-CI run [#42675741570](https://github.com/Sami20178/All-World-App/actions/runs/42675741570) completed before this deployment and is not a post-deploy smoke test. No HTTP registration/login/logout or browser-cookie test after this deployment is confirmed. The production account lifecycle must remain unverified until a post-deploy smoke test runs safely; do not create a real user account for testing.

The KDF remains a release/security blocker: the project previously observed a Worker runtime failure above 100,000 PBKDF2 iterations in isolated preview diagnostics, while production still uses 310,000. The 100,000-iteration PBKDF2-SHA-512 preview candidate remains below the current OWASP PBKDF2-SHA-512 recommendation and is not approved for production. Do not lower the production work factor as a quick fix. Evaluate a Worker-compatible Argon2id/scrypt implementation or a managed auth service with real runtime, memory, concurrency, and migration tests before changing password storage.

Email verification, password reset, and external OAuth remain unavailable until the required token schema, transactional mail service, provider configuration, and end-to-end tests exist.
 
## Post-deployment smoke follow-up — 2026-11-09

The following successful runs occurred after production deployment 72a69a24-5178-4164-8c13-7af85012e921:

- [Live API/MCP smoke #42675741552](https://github.com/Sami20178/All-World-App/actions/runs/42675741552), attempt 2: passed. The account-auth portion checked /api/health, /api/ready, and /api/auth/providers; provider discovery returned 0 providers. It was read-only and created or changed no accounts.
- [Cloudflare Auth Worker validation #42675741140](https://github.com/Sami20178/All-World-App/actions/runs/42675741140): passed on the isolated preview. Its synthetic E2E covered health/readiness, anonymous-route protection, registration, session restoration, email login, wrong-password rejection, session rotation, logout, and synthetic account deletion. This is preview evidence, not a production account-lifecycle test.
- [Live API/MCP smoke #42679974690](https://github.com/Sami20178/All-World-App/actions/runs/42679974690): passed. It exercised MCP OAuth 2.1 authorization-code/PKCE, token exchange, authenticated MCP initialization, tool listing, get_api_health, get_site_info, and the one-time private plugin-settings launch. Its account-auth checks again passed health/readiness/provider discovery and reported 0 providers.
- [API CI #42679974675](https://github.com/Sami20178/All-World-App/actions/runs/42679974675): passed.
- Team-Server [Auth Worker validation #42679984279](https://github.com/World-Team/All-World-App-Team-Place/actions/runs/42679984279): local validation passed; preview-smoke was skipped by that mirror workflow.

A read-only D1 verification recorded 0 users, 0 sessions, 0 OAuth identities, and 0 OAuth states, with changed_db=false and rows_written=0.

**What is still not proven:** no production registration/login/logout or browser-cookie lifecycle test was run. The read-only production smoke does not create an account. The preview E2E uses a separate Worker and D1. Production still uses PBKDF2-HMAC-SHA-256 at 310,000 iterations, so the previously observed Worker compatibility risk above 100,000 iterations remains unresolved.

The remote scrypt/Argon2id benchmark in draft PR [#19](https://github.com/Sami20178/All-World-App/pull/19) has not run because the GitHub Actions secret CLOUDFLARE_API_TOKEN is not configured. Do not paste a token into chat or commit it; configure it only through the repository's protected Actions secret settings if the project owner authorizes that step.

No production D1 rows, secrets, bindings, DNS records, or OAuth provider settings were changed by these smoke tests.