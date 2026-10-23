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

Email verification and password reset are still not implemented in this Worker. Do not connect the production frontend until the Worker is deployed, its D1 binding and APP_ORIGIN are configured, provider credentials are added through Cloudflare secret settings, and live HTTPS tests pass.

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

The frontend API URL must remain unchanged until the deployed endpoint has been verified with external HTTPS requests.
