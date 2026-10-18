# All World — Node.js API Server

## Konten, Anmeldung und Datenbank

Die API speichert Konten dauerhaft in SQLite: `data/all-world.sqlite` (oder im Pfad aus `DATABASE_FILE`). Passwörter werden mit bcrypt gehasht. Benutzernamen sind unabhängig von Groß-/Kleinschreibung eindeutig.

- `POST /api/auth/register` — Konto mit eindeutigem Benutzernamen, E-Mail-Adresse und Passwort erstellen und anmelden
- `POST /api/auth/login` — mit Benutzername oder E-Mail-Adresse und Passwort anmelden; ein Konto bleibt nach dem Abmelden gespeichert
- E-Mail-Adressen werden normalisiert und eindeutig gespeichert; bestehende SQLite-Datenbanken erhalten die neuen E-Mail-Spalten per additiver Migration, ohne vorhandene Konten zu löschen.
- `GET /api/auth/me` — angemeldetes Konto ermitteln
- `POST /api/auth/logout` — Sitzung beenden, Konto nicht löschen
- `GET /api/auth/linked` — verbundenen Konten anzeigen
- `POST /api/auth/link` — weiteres Konto verbinden; dessen Passwort ist erforderlich
- `POST /api/auth/switch` — zu einem bereits verbundenen Konto wechseln
- `GET /api/account` — geschützter Kontobereich
- `DELETE /api/account` — aktives Konto nach Passwortbestätigung dauerhaft löschen

Sitzungen werden ebenfalls in SQLite gespeichert und laufen nach sieben Tagen ab. Konto-Verbindungen sind bidirektional. Das Verbinden erfordert die Zugangsdaten des zweiten Kontos, damit niemand fremde Konten nur durch Kenntnis eines Benutzernamens verknüpfen kann.

Beim Löschen werden das Konto, seine Kontoverbindungen, alle Sitzungen dieses Kontos und zugehörige Datensätze aus der Tabelle `user_data` entfernt. Andere verbundene Konten bleiben bestehen, verlieren aber die Verbindung zum gelöschten Konto. Ein gelöschter Benutzername kann nach der Löschung erneut verwendet werden; das gelöschte Konto selbst und seine ID können sich nicht mehr anmelden. Daten, die in externen Diensten gespeichert sind, müssen dort separat gelöscht werden.

Wenn `data/users.json` aus dem früheren Prototyp vorhanden ist, werden gültige Konten einmalig nach SQLite übernommen; die ursprüngliche Datei wird als Backup nicht gelöscht. Nach der Migration ist SQLite die maßgebliche Datenbank.

## Deployment

Für ein Docker-basiertes Produktionssetup mit persistentem SQLite-Volume, HTTPS-Reverse-Proxy-Hinweisen und OAuth-Callback-Konfiguration siehe [`DEPLOYMENT.md`](./DEPLOYMENT.md). Docker-Dateien: `Dockerfile`, `compose.yaml` und `.dockerignore`. Das Hinzufügen der Dateien bedeutet nicht, dass die API bereits gehostet oder veröffentlicht wurde.

## Lokal starten

1. Node.js 20 oder neuer installieren.
2. `npm install` ausführen.
3. `.env.example` nach `.env` kopieren und konfigurieren.
4. `npm start` ausführen.
5. `npm test` ausführen.

Für die lokale Frontend-Entwicklung kann `APP_ORIGIN=http://localhost:5500` verwendet werden. Die Frontend-Datei `app.js` erwartet die API-Adresse in `window.ALL_WORLD_API_URL` oder verwendet standardmäßig `http://localhost:3000`.

## Vor öffentlicher Bereitstellung

- HTTPS aktivieren und `APP_ORIGIN` auf den exakten Frontend-Ursprung setzen.
- Einen langen zufälligen `SESSION_SECRET` (mindestens 32 Zeichen) über Umgebungsvariablen konfigurieren.
- Datenbankdatei und Backups schützen; niemals `.env` oder `data/` committen oder die SQLite-Datei öffentlich ausliefern.
- Tests und Hosting-Integration prüfen, bevor das System für echte Nutzer freigeschaltet wird.

## Social sign-in (OAuth 2.0)

The API supports configurable OAuth 2.0 authorization-code providers without storing provider passwords. Configure `API_PUBLIC_URL` as the public HTTPS API origin and set `OAUTH_PROVIDERS_JSON` as a server environment variable. Each provider entry needs `clientId`, `clientSecret`, `authorizeUrl`, `tokenUrl`, `userInfoUrl`; optional keys are `scopes`, `idField`, `nameField`, `userInfoPath`, `clientAuthMethod` (`body` by default, or `basic`), `clientIdHeader` for APIs that require the app ID in a user-info request header, and `pkce: true` to enable Authorization Code + PKCE (S256). Roblox and X should use PKCE. The server keeps the verifier in the session and sends it only to the token endpoint. Register each exact callback URL as `https://YOUR-API-HOST/api/auth/oauth/PROVIDER/callback` with the identity provider. The UI only enables providers with valid server-side configuration.

Example JSON shape (replace all placeholders with credentials from each provider's developer console; never commit real secrets):

```json
{
  "google": {"clientId":"...","clientSecret":"...","authorizeUrl":"https://accounts.google.com/o/oauth2/v2/auth","tokenUrl":"https://oauth2.googleapis.com/token","userInfoUrl":"https://openidconnect.googleapis.com/v1/userinfo","scopes":"openid email profile","idField":"sub","nameField":"name","clientAuthMethod":"body"},
  "apple": {"clientId":"YOUR_APPLE_SERVICES_ID","teamId":"YOUR_APPLE_TEAM_ID","keyId":"YOUR_APPLE_KEY_ID","privateKey":"-----BEGIN PRIVATE KEY-----\\nREPLACE_WITH_PRIVATE_KEY_CONTENT\\n-----END PRIVATE KEY-----","scopes":"name email"},
  "github": {"clientId":"...","clientSecret":"...","authorizeUrl":"https://github.com/login/oauth/authorize","tokenUrl":"https://github.com/login/oauth/access_token","userInfoUrl":"https://api.github.com/user","scopes":"read:user user:email","idField":"id","nameField":"login","clientAuthMethod":"body"},
  "microsoft": {"clientId":"...","clientSecret":"...","authorizeUrl":"https://login.microsoftonline.com/common/oauth2/v2.0/authorize","tokenUrl":"https://login.microsoftonline.com/common/oauth2/v2.0/token","userInfoUrl":"https://graph.microsoft.com/oidc/userinfo","scopes":"openid profile email User.Read","idField":"sub","nameField":"name","clientAuthMethod":"body"},
  "x": {"clientId":"...","clientSecret":"...","authorizeUrl":"https://twitter.com/i/oauth2/authorize","tokenUrl":"https://api.twitter.com/2/oauth2/token","userInfoUrl":"https://api.twitter.com/2/users/me?user.fields=name,username","scopes":"users.read tweet.read offline.access","idField":"data.id","nameField":"data.username","clientAuthMethod":"basic","pkce":true},
  "roblox": {"clientId":"...","clientSecret":"...","authorizeUrl":"https://apis.roblox.com/oauth/v1/authorize","tokenUrl":"https://apis.roblox.com/oauth/v1/token","userInfoUrl":"https://apis.roblox.com/oauth/v1/userinfo","scopes":"openid profile","idField":"sub","nameField":"preferred_username","clientAuthMethod":"body","pkce":true},
  "amazon": {"clientId":"...","clientSecret":"...","authorizeUrl":"https://www.amazon.com/ap/oa","tokenUrl":"https://api.amazon.com/auth/o2/token","userInfoUrl":"https://api.amazon.com/user/profile","scopes":"profile","idField":"user_id","nameField":"name","clientAuthMethod":"body"},
  "discord": {"clientId":"...","clientSecret":"...","authorizeUrl":"https://discord.com/oauth2/authorize","tokenUrl":"https://discord.com/api/oauth2/token","userInfoUrl":"https://discord.com/api/users/@me","scopes":"identify email","idField":"id","nameField":"username","clientAuthMethod":"body"},
  "spotify": {"clientId":"...","clientSecret":"...","authorizeUrl":"https://accounts.spotify.com/authorize","tokenUrl":"https://accounts.spotify.com/api/token","userInfoUrl":"https://api.spotify.com/v1/me","scopes":"user-read-private user-read-email","idField":"account_id","nameField":"display_name","clientAuthMethod":"basic"},
  "gitlab": {"clientId":"...","clientSecret":"...","authorizeUrl":"https://gitlab.com/oauth/authorize","tokenUrl":"https://gitlab.com/oauth/token","userInfoUrl":"https://gitlab.com/api/v4/user","scopes":"read_user","idField":"id","nameField":"username","clientAuthMethod":"body"},
  "twitch": {"clientId":"...","clientSecret":"...","authorizeUrl":"https://id.twitch.tv/oauth2/authorize","tokenUrl":"https://id.twitch.tv/oauth2/token","userInfoUrl":"https://api.twitch.tv/helix/users","scopes":"user:read:email","idField":"data.0.id","nameField":"data.0.display_name","clientIdHeader":"Client-ID","clientAuthMethod":"body"}
}
```

Provider endpoint requirements can change, so verify each provider's current official documentation and exact redirect URI before enabling it. Google, GitHub, Microsoft, X, Roblox, Amazon, Discord, Spotify, GitLab and Twitch can use this generic adapter when their app registration, exact callback URI, scopes and credentials are configured correctly. Spotify uses Basic client authentication; Twitch also requires the `Client-ID` header for its user endpoint. Roblox and X now support PKCE (S256) in the generic adapter, and automated tests verify the authorization challenge and session-bound state. This is integration code, not a claim that provider credentials or live sign-ins have already been tested. Apple uses a dedicated adapter: configure a Services ID as `clientId`, Apple Team ID, Key ID and the `.p8` private key in the server-only `OAUTH_PROVIDERS_JSON`. The adapter generates a short-lived ES256 client-secret JWT, uses `form_post`, and verifies Apple ID-token signatures, issuer, audience, expiry and nonce before creating or linking an account. Register the exact HTTPS callback URL with Apple. Never commit the private key. Additional standard OAuth 2.0 providers can be added by adding a configuration entry. Linking a provider while logged in attaches its stable provider ID to the current account; email-address matching alone is never used to merge accounts.
