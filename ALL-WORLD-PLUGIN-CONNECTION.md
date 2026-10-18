# All World plugin connection endpoints

The public, read-only endpoints are served by the Cloudflare Worker `all-world-app`:

- `GET https://all-world-app.docc-samisoliman.workers.dev/api/plugin/health`
- `GET https://all-world-app.docc-samisoliman.workers.dev/api/plugin/site-info`
- `POST https://all-world-app.docc-samisoliman.workers.dev/mcp` — stateless MCP JSON-RPC endpoint for read-only tools.

## MCP tools

The MCP endpoint exposes two public read-only tools:

- `get_api_health` — returns service health metadata.
- `get_site_info` — returns the canonical website and repository metadata.

MCP discovery and tool calls use JSON-RPC methods `initialize`, `tools/list`, and `tools/call`. No account records, credentials, or database writes are exposed. The endpoint is intentionally unauthenticated because it exposes public metadata only.

The website itself remains on the separate Worker `all-world-app-source-code`. The OpenAPI connection document is maintained in the source repository at [integrations/all-world-plugin/openapi.yaml](https://github.com/Sami20178/All-World-App-Source-Code-/blob/main/integrations/all-world-plugin/openapi.yaml).

## Deployment and verification

The `all-world-app` Worker was updated through Cloudflare and its `workers.dev` subdomain is enabled. GitHub Actions checks the two GET routes, MCP initialization, tool discovery, and both read-only tool calls on pushes to `main`, manually, and every six hours. Check the [workflow results](https://github.com/Sami20178/All-World-App/actions/workflows/check-cloudflare-api.yml) before treating runtime verification as passed.

The existing ChatGPT plugin is configured through its `mcp.json` connection to the endpoint. After publishing the plugin update, verify that `get_api_health` and `get_site_info` appear as callable tools in ChatGPT. A deployed MCP server alone does not prove that the host has attached or activated the tools.

Never put secrets in the OpenAPI document or public source repository.
