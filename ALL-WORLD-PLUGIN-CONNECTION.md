# All World plugin connection endpoints

The API server provides two public, read-only endpoints for the All World plugin:

- `GET /api/plugin/health`
- `GET /api/plugin/site-info`

They are implemented in `server.js` and return service status and public project metadata only. They do not read or expose user accounts and cannot write to the database.

The OpenAPI connection document is maintained in the source repository at [integrations/all-world-plugin/openapi.yaml](https://github.com/Sami20178/All-World-App-Source-Code-/blob/main/integrations/all-world-plugin/openapi.yaml).

## To finish the live connection
1. Deploy this Node API to a real HTTPS origin.
2. Test both routes on that origin.
3. Replace the placeholder server URL in the OpenAPI file with that exact origin.
4. Configure an API/action-capable plugin client to use the OpenAPI document. The current All World plugin is instruction-based, so its API tools still need to be connected separately; this commit alone does not deploy the API or attach tools.

Never put secrets in the OpenAPI document or public source repository.
