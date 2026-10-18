# All World plugin connection endpoints

The public, read-only endpoints are served by the Cloudflare Worker `all-world-app`:

- `GET https://all-world-app.docc-samisoliman.workers.dev/api/plugin/health`
- `GET https://all-world-app.docc-samisoliman.workers.dev/api/plugin/site-info`

The website itself remains on the separate Worker `all-world-app-source-code`. The API endpoints return service status and public project metadata only; they do not read user accounts or write to a database.

The OpenAPI connection document is maintained in the source repository at [integrations/all-world-plugin/openapi.yaml](https://github.com/Sami20178/All-World-App-Source-Code-/blob/main/integrations/all-world-plugin/openapi.yaml).

## Deployment and verification
The `all-world-app` Worker was updated and its `workers.dev` subdomain enabled through Cloudflare. The OpenAPI server URL points to that HTTPS origin. Confirm the two GET routes from an external HTTP client and configure an API/action-capable plugin client to use the OpenAPI document. Updating the spec alone does not automatically attach API tools to an instruction-based plugin.

Never put secrets in the OpenAPI document or public source repository.
