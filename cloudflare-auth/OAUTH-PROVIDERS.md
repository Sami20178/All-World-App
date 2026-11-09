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
## Anbieter-Audit 09.11.2026 – offizielle Anforderungen und tatsächlicher Projektstatus

| Anbieter | Offizieller Flow | Aktueller Projektstatus | Vor einer Aktivierung erforderlich |
|---|---|---|---|
| Google | OpenID Connect, Authorization Code; Discovery über `https://accounts.google.com/.well-known/openid-configuration` | Nicht konfiguriert. Der generische Worker kann Token/UserInfo abrufen, validiert aber aktuell kein OIDC-ID-Token mit JWKS/Issuer/Audience/Nonce. | Google-Client-ID/-Secret, exakte Callback-URL, `openid profile email`, PKCE S256 und vollständige ID-Token-/Nonce-/JWKS-Prüfung. |
| Microsoft Entra ID | OpenID Connect; tenantbezogene Discovery und Endpunkte | Nicht konfiguriert. Keine Entra-App und keine Zugangsdaten bestätigt. | Tenant-/Authority-Auswahl, Client-ID/-Secret, exakte Callback-URL, `openid profile email`, PKCE und ID-Token-Prüfung gegen Tenant-Issuer/JWKS/Audience/Nonce. |
| GitHub | OAuth 2.0 Web Application Flow, kein allgemeiner OIDC-ID-Token-Flow | Nicht konfiguriert. Der generische Worker kann prinzipiell einen OAuth-UserInfo-Endpunkt verwenden; kein GitHub-OAuth-App-Nachweis vorhanden. | OAuth-App, exakte Callback-URL, zufälliger State, PKCE S256, minimale Scopes `read:user user:email`; stabile ID aus `/user`. Private E-Mail-Adressen benötigen die passende E-Mail-Berechtigung und eine zusätzliche Prüfung; E-Mail darf optional bleiben. |
| Roblox | OAuth 2.0 Authorization Code + PKCE und OIDC-Identität; Dokumentation kennzeichnet OAuth 2.0 als Beta | Nicht konfiguriert. Kein Roblox-Client vorhanden. Der generische Worker validiert noch kein OIDC-ID-Token. | Roblox-App, exakte Callback-URL, `openid profile`, PKCE S256, Discovery/UserInfo/JWKS prüfen und ID-Token-Signatur/Issuer/Audience/Nonce validieren. Roblox dokumentiert, dass ein 13+-Konto zur Autorisierung von OAuth-Apps erforderlich ist. |
| Apple | Sign in with Apple mit signiertem ID-Token; Schlüssel über `https://appleid.apple.com/auth/keys` | Im Cloudflare-Worker ausdrücklich reserviert und nicht aktiviert. Die Auth.js-Referenzdatei importiert einen Apple-Provider, ist aber laut Kommentar nicht in den normalen Server eingebunden. | Eigener Apple-Callback: Client-Secret-JWT, ES256/JWKS-Signaturprüfung, Issuer, Audience/Services-ID, Ablaufzeit und Nonce prüfen; Schlüsselrotation unterstützen. Der generische UserInfo-Adapter reicht dafür nicht. |
| Supercell | – | Ausgeschlossen, wie vom Projekt festgelegt. | Nicht implementieren. |

### Gemeinsame Sicherheitsgrenze

- Produktions-`OAUTH_PROVIDERS_JSON` ist nicht gesetzt; die Live-Provider-Discovery meldet 0 Anbieter.
- Die vorhandene Worker-Implementierung nutzt State, browsergebundene HttpOnly/Secure-Cookies, kurzlebige D1-State-Einträge, Rate-Limits und optional PKCE. Sie validiert derzeit aber keine OIDC-ID-Tokens anhand von JWKS, Issuer, Audience und Nonce.
- Daher werden Google, Microsoft und Roblox trotz offizieller OIDC-Unterstützung **nicht** als produktionsbereit bezeichnet. GitHub ist OAuth 2.0 und benötigt einen eigenen echten App-Test. Apple benötigt einen separaten Adapter.
- Die Referenzdatei `server-integrations/authjs/express-auth.config.ts` ist ausdrücklich nicht in `normal-server` verdrahtet. Eine Provider-Importzeile ist kein funktionsfähiger Login.
- Keine Provider-Client-ID, kein Secret, kein privater Schlüssel und keine Callback-Registrierung wurden erstellt oder gespeichert.

### Offizielle Primärquellen

- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) · [Google Discovery](https://accounts.google.com/.well-known/openid-configuration)
- [Apple Sign in with Apple REST API](https://developer.apple.com/documentation/signinwithapplerestapi) · [Apple user verification](https://developer.apple.com/documentation/signinwithapple/verifying-a-user) · [Apple public keys](https://developer.apple.com/documentation/signinwithapplerestapi/fetch-apple%27s-public-key-for-verifying-token-signature)
- [Microsoft OIDC](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc)
- [GitHub OAuth App authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [Roblox OAuth 2.0 overview](https://create.roblox.com/docs/cloud/auth/oauth2-overview) · [Roblox OAuth 2.0 reference](https://create.roblox.com/docs/cloud/auth/oauth2-reference)

**Geprüft:** 09.11.2026. Die Links belegen die offiziellen Protokollanforderungen, nicht eine aktive All-World-Provider-Konfiguration.
