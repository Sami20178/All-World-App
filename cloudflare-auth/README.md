# Cloudflare Auth API

This directory contains a separate Cloudflare Workers + D1 implementation for All World account endpoints. It is deliberately separate from the existing MCP Worker and from the Node.js server so that neither current service is overwritten.

## Included now

- Username registration and login, with optional email and login by username or email.
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
