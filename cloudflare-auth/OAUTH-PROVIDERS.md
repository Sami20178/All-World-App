# All World OAuth / OpenID Connect provider setup

The sign-in API uses one server-side OAuth 2.0 Authorization Code flow. Providers are enabled only when valid server-side credentials and endpoints are configured. The frontend catalog is informational; a button is clickable only when the API reports that provider as enabled.

## Supported provider model

The generic adapter can work with OAuth 2.0 or OpenID Connect providers that expose:
- an HTTPS authorization endpoint;
- an HTTPS token endpoint that accepts the authorization-code grant;
- an HTTPS user-info/profile endpoint returning a stable account identifier;
- a client ID and client secret.

Provider-specific scopes, profile paths, ID/name fields, PKCE, and client authentication method can be configured. This covers common services such as Google, GitHub, Microsoft Entra ID, Discord, Facebook, X, LinkedIn, GitLab, Bitbucket, Amazon, Twitch, Spotify, Dropbox, Slack, Reddit, Okta, Auth0, and Keycloak, plus compatible custom OAuth/OIDC servers. This is not a promise that every service supports every flow or that credentials have been created.

Apple Sign in is not enabled by this generic adapter: Apple returns a signed identity token and does not provide the same generic user-info endpoint. It must remain disabled until a dedicated ID-token signature, issuer, audience, nonce, and key-rotation validation path is implemented. Supercell is intentionally excluded.

## Required callback URL

Register this exact callback URL separately in each provider's developer console:

`https://all-world-auth-api.docc-samisoliman.workers.dev/api/auth/oauth/PROVIDER_ID/callback`

Replace `PROVIDER_ID` with the lowercase provider key, for example `google` or `github`. The callback URL must match exactly, including HTTPS and path.

## Secret configuration

Set `OAUTH_PROVIDERS_JSON` as a Cloudflare Worker secret for `all-world-auth-api`. Never put client secrets in `app.js`, `index.html`, `config.js`, GitHub commits, or public issue comments.

Example shape (placeholders only; not usable credentials):

```json
{
  "google": {
    "label": "Google",
    "clientId": "YOUR_CLIENT_ID",
    "clientSecret": "YOUR_CLIENT_SECRET",
    "authorizeUrl": "https://accounts.google.com/o/oauth2/v2/auth",
    "tokenUrl": "https://oauth2.googleapis.com/token",
    "userInfoUrl": "https://openidconnect.googleapis.com/v1/userinfo",
    "scopes": "openid profile email",
    "pkce": true,
    "idField": "sub",
    "nameField": "name"
  },
  "github": {
    "label": "GitHub",
    "clientId": "YOUR_CLIENT_ID",
    "clientSecret": "YOUR_CLIENT_SECRET",
    "authorizeUrl": "https://github.com/login/oauth/authorize",
    "tokenUrl": "https://github.com/login/oauth/access_token",
    "userInfoUrl": "https://api.github.com/user",
    "scopes": "read:user user:email",
    "pkce": true,
    "idField": "id",
    "nameField": "login",
    "clientAuthMethod": "body"
  }
}
```

Add each provider as another object entry. All URLs must use HTTPS. The API rejects malformed entries. Use the provider's official documentation to confirm current endpoints, scopes, PKCE support, and token authentication requirements.

## Configuration fields

- `label`: button label shown to users.
- `clientId` / `clientSecret`: credentials created for the All World app at the provider.
- `authorizeUrl`, `tokenUrl`, `userInfoUrl`: provider HTTPS endpoints.
- `scopes`: scope string or array.
- `pkce`: set true only when the provider's authorization-code flow supports S256 PKCE.
- `idField`: stable unique ID in the profile response (often `id` or `sub`).
- `nameField`: display name field (often `name`, `login`, or `username`).
- `userInfoPath`: optional path to a nested profile object.
- `emailVerifiedField`: optional boolean field; an email is saved only when the provider explicitly reports it verified.
- `clientAuthMethod`: `body` (default) or `basic`, depending on the provider.
- `clientIdHeader`: optional provider-specific header, for example `Client-Id` where required.
- `extraAuthorizeParams`: optional non-secret authorization parameters.

## Activation and testing checklist

1. Create an OAuth/OIDC app with the provider and set the exact callback URL.
2. Add the provider entry to the Cloudflare secret. Do not commit credentials.
3. Confirm `GET /api/auth/providers` reports the provider as enabled.
4. Test a new account, a returning account, cancellation, and linking while signed in.
5. Confirm that the provider identity is stored once and that a second account cannot claim it.
6. Do not advertise a provider as live until a real browser login and callback have succeeded.

The existing flow uses a one-time random state stored hashed in D1, an HttpOnly/Secure state cookie, a short-lived callback record, rate limits, and optional PKCE. A provider being listed in the frontend catalog does not mean it is configured or live.
