# All World plugin connection endpoints

Prüfstand: 13. November 2026

## Live endpoints

The Cloudflare Worker `all-world-app` serves the public metadata routes and the MCP connection:

- `GET https://all-world-app.docc-samisoliman.workers.dev/api/plugin/health` — public Worker health response.
- `GET https://all-world-app.docc-samisoliman.workers.dev/api/plugin/site-info` — static public project metadata.
- `POST https://all-world-app.docc-samisoliman.workers.dev/mcp` — MCP Streamable HTTP / JSON-RPC endpoint.

The website is a separate Worker: [all-world-app-source-code](https://all-world-app-source-code.docc-samisoliman.workers.dev/).

## MCP tools actually advertised

The current `worker.js` source advertises three tools:

| Tool | Behavior | Limits |
|---|---|---|
| `get_api_health` | Returns the public status response from the MCP Worker. | It confirms that this Worker answered; it does not probe the Node.js API, account-auth database, or every backend dependency. |
| `get_site_info` | Returns the canonical website and repository metadata. | Static metadata, not a live GitHub crawler. |
| `open_plugin_settings` | Creates a one-time launch link to the permissions preview page. | Link expires after five minutes and is consumed once. Checkbox choices remain in the current browser session only; they are not stored server-side and do not enable account or write features. |

The settings page is a preview, not an account-management screen. It must not be described as persistent permissions, a working Full Connect grant, or a login system.

## MCP authentication is separate from All World account login

The MCP endpoint is OAuth-protected. It advertises OAuth authorization-code flow with PKCE S256, dynamic client registration, and the `mcp:read` scope. The GitHub Actions smoke test exercises discovery, registration, consent, PKCE exchange, authenticated MCP initialization, tool listing, tool calls, and the one-time settings link.

This OAuth flow authenticates the MCP client connection. It is not Google, Apple, Microsoft, GitHub, or Roblox sign-in for an All World user account.

The MCP tools do not expose user records, password hashes, sessions, or account-write operations. The short-lived launch token is stored as a hash in the MCP launch table and is separate from user-account data.

## Separate account-auth service: current production limits

The account-auth Worker is `all-world-auth-api`, not the public MCP Worker.

Cloudflare settings inspected on 13 November 2026 show production bindings for `APP_ORIGIN`, `AUTH_DB`, and `RATE_LIMIT_SECRET`. No `OAUTH_PROVIDERS_JSON` or transactional email-service binding is configured. The live provider-discovery smoke test does not establish any active social-login provider.

Consequently, do not advertise Google, Apple, Microsoft, GitHub, Roblox, email verification, or password reset as production-ready. The current production D1 schema also lacks the required email-verification and password-reset token tables/fields. Supercell remains excluded.

The current repository source contains newer auth tests, including persistent login rate-limit coverage, but the production account-auth Worker was last deployed on 9 November 2026. A passing source test is not evidence that newer source code is deployed.

## Verification evidence

- [Latest successful live MCP/account-auth smoke run](https://github.com/Sami20178/All-World-App/actions/runs/43380619895) — 13 November 2026. It checks the public routes, OAuth discovery/PKCE, all three MCP tools, the one-time launch page, account-auth health, and provider discovery.
- [Smoke-test workflow](https://github.com/Sami20178/All-World-App/actions/workflows/check-cloudflare-api.yml).
- [MCP Worker source](https://github.com/Sami20178/All-World-App/blob/main/worker.js).
- [Account-auth Worker source](https://github.com/Sami20178/All-World-App/blob/main/cloudflare-auth/worker.mjs).
- [OpenAPI connection specification](https://github.com/Sami20178/All-World-App-Source-Code-/blob/main/integrations/all-world-plugin/openapi.yaml) — currently describes the public REST routes; it does not yet fully describe the MCP tool schemas.

The successful smoke run proves the tested deployed Worker behavior at that time. It does not prove that the private plugin is visible or callable in every ChatGPT client; that requires a separate host-side check.

## Deployment rules

- Keep the public MCP tools read-only.
- Do not expose account data or database writes through the public MCP endpoint.
- Do not add a social provider until its official OAuth/OIDC configuration, callback URL, secrets, and tests exist.
- Do not claim email verification or password reset until a transactional mail service and end-to-end tests exist.
- Never commit API keys, OAuth secrets, session secrets, private keys, or database files.
- Distinguish source commit, successful test, Worker deployment, and host-side plugin verification.
