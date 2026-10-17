# All World — Node.js API Server

## Konten, Anmeldung und Datenbank

Die API speichert Konten dauerhaft in SQLite: `data/all-world.sqlite` (oder im Pfad aus `DATABASE_FILE`). Passwörter werden mit bcrypt gehasht. Benutzernamen sind unabhängig von Groß-/Kleinschreibung eindeutig.

- `POST /api/auth/register` — Konto erstellen und anmelden
- `POST /api/auth/login` — anmelden; ein Konto bleibt nach dem Abmelden gespeichert
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
