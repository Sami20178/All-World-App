# Cloudflare Auth API

This directory contains a separate Cloudflare Workers + D1 implementation for All World account endpoints. It is deliberately separate from the existing MCP Worker and from the Node.js server so that neither current service is overwritten.

## Included now

- Username registration and login, with optional email and login by username or email.
- PBKDF2-HMAC-SHA-256 password hashes using a per-user random salt.
- Persistent D1 sessions stored as token hashes; cookies are HttpOnly, Secure, and SameSite=None.
- Exact HTTPS Origin checks for state-changing requests, credentialed CORS, request-size validation, and persistent rate limits.
- Account listing/linking/switching, account data CRUD, logout, and account deletion with password confirmation.
- A D1 schema that can be applied repeatedly without deleting existing rows.

## Not yet enabled

Social/OAuth sign-in, email verification, and password reset are not implemented in this Worker yet. The provider endpoint returns an empty list instead of showing unconfigured providers as active. Do not connect the production frontend until the Worker is deployed, its D1 binding and APP_ORIGIN are configured, and the live smoke tests pass.

## Configuration

The production deployment uses the dedicated D1 database all-world-auth bound as AUTH_DB. APP_ORIGIN is set to the exact HTTPS origin of the public All World frontend. RATE_LIMIT_SECRET is a Cloudflare secret binding with a random value of at least 32 characters; it HMACs rate-limit keys so raw IP addresses are not stored. Do not reuse the existing OAUTH_DB used by the MCP service. Keep credentials and any future provider secrets in Cloudflare secret bindings, never in Git.

The Worker code initializes tables with CREATE TABLE IF NOT EXISTS; schema.sql is also provided for review and explicit migrations. The test uses a local SQLite adapter to exercise the Worker request handler without modifying production data.

## Endpoints

GET /api/health and GET /api/ready
GET /api/auth/providers
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
