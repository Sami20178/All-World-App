# All World — Server- und App-Release-Register

Die App-Versionen werden mit dem Frontend-Repository abgestimmt: [All-World-App-Source-Code-](https://github.com/Sami20178/All-World-App-Source-Code-).

## Verbindliche Reihenfolge

1. `First Classic 0.0.0.0` bis `First Classic 9.9.9.9`
2. `Classic 0.0.0.0` bis `Classic 9.9.9.9`
3. `Alpha 0.0.0.0` bis `Alpha 9.9.9.9`
4. `Beta 0.0.0.0` bis `Beta 9.9.9.9`
5. `Version 0.0.0.0` bis `Version 9.9.9.9`
6. Danach `Version 0.0.0.0.0` und die fünfstellige Reihe fortsetzen.

## First Classic 0.0.0.0

- Zweck: erste gemeinsame App-/Server-Versionslinie.
- Frontend enthält ein Android-WebView-Projekt; GitHub Actions hat die Debug-APK im aktuellen Lauf [#38121946839](https://github.com/Sami20178/All-World-App-Source-Code-/actions/runs/38121946839) gebaut. Der Workflow hat APK-Signatur und gebündelte Web-Assets erfolgreich geprüft; eine Geräteinstallation und Kernfunktionstests sind noch offen. Der Build ist eine Debug-APK, keine Produktionssignierung.
- Build-Workflow: [Frontend Android Actions #38121946839](https://github.com/Sami20178/All-World-App-Source-Code-/actions/runs/38121946839), Commit `0a42f6f2a78147b4795df022f81c1ceed0fde7bd`.
- Der Server stellt Authentifizierungs-Endpunkte bereit, muss aber auf einer erreichbaren HTTPS-Adresse betrieben und passend zur App konfiguriert werden.
- Server-Validierung mit Syntaxcheck und neuen API-Smoke-Tests erfolgreich: [Lauf #38126297531](https://github.com/Sami20178/All-World-App/actions/runs/38126297531), Commit `be57c4cde622e3271ac9c8e1b5f290b83b69d7e3`. Abgedeckt sind Health, Eingabevalidierung, Registrierung, Duplikatschutz, Sitzung, geschützter Account-Endpunkt, Login und Logout. Das ist kein Produktionstest.
- Das Server-Repository enthält die Legacy-Release [All World](https://github.com/Sami20178/All-World-App/releases/tag/All-World) mit Tag `All-World` (2026-10-28). Sie gehört nicht zum Versionsschema und bleibt unverändert; eine Release `First Classic 0.0.0.0` existiert noch nicht.
- Release-Status: noch nicht veröffentlicht.
- APK: wird ausschließlich im Frontend-Repository aus dem Android-Projekt gebaut; erst nach Installations-/Kernfunktionstests als echtes Release-Asset verlinken. Der Server selbst ist keine APK.
- Die aktuelle Server-Dateispeicherung in JSON und der In-Memory-Session-Store sind Starter-Konfigurationen, nicht für öffentlichen Produktionseinsatz ausreichend.

## Release-Regeln

- Release-Titel, Versionsnummer, Änderungsprotokoll und Status mit dem Frontend abstimmen.
- Keine Versionsnummer doppelt vergeben oder bestehende Releases überschreiben.
- Ein gemeinsamer App-Release darf erst als veröffentlicht bezeichnet werden, wenn eine echte, erfolgreich gebaute und angemessen geprüfte Android-APK vorhanden ist und die zugehörigen Release-Assets/Links tatsächlich funktionieren.
- Der Server-Release dokumentiert die Server-Änderungen und verweist auf die passende Frontend-Release. APK/AAB dürfen nur als echte Build-Dateien angehängt werden, nicht als Platzhalter.
- Keine Geheimnisse, Tokens, `.env`-Dateien oder Nutzerdaten einchecken.

## Aktueller Versionsstatus 2026-10-23 19:34 UTC

- GitHub-API-Prüfung: keine Tags und keine Releases im Server- oder Frontend-Repository. Nächste gemeinsame App-Version bleibt `First Classic 0.0.0.0`.
- Aktueller Backend-Commit: [`c6126800164cc8b5b8c5b7e238eae3298368fbd4`](https://github.com/Sami20178/All-World-App/commit/c6126800164cc8b5b8c5b7e238eae3298368fbd4). Node-Server-, Cloudflare-Auth-, API-CI- und MCP-OAuth-Smoke-Workflows waren erfolgreich.
- Cloudflare-Auth-Worker ist mit D1-Schema aktiv; `OAUTH_PROVIDERS_JSON` fehlt, daher sind externe OAuth-Anbieter nicht aktiviert. Externe HTTP-/End-to-End-Tests sind noch offen.
- Das Android-Artefakt gehört zum Frontend-Repository und ist eine temporäre Debug-APK, kein Server-Binary. Wegen fehlender Geräteinstallation und nicht abgeschlossener Live-Tests wurde kein Release angelegt.
- Der neue Frontend-Deployment-Workflow konnte wegen des fehlenden GitHub-Secrets `CLOUDFLARE_API_TOKEN` nicht deployen. Der Server-Release bleibt ebenfalls unveröffentlicht.

- Live-Nachweis am 2026-10-23: [MCP OAuth-/End-to-End-Smoke-Test #40012531417](https://github.com/Sami20178/All-World-App/actions/runs/40012531417) bestand über HTTPS auf dem Worker `all-world-app` (Health, OAuth-Discovery, PKCE, Tokenaustausch und authentifizierte MCP-Werkzeuge). Dieser Test gilt für MCP-/ChatGPT-OAuth, nicht für die separate Konto-API `all-world-auth-api` oder externe Social-Login-Provider. Für diese Konto-API fehlt weiterhin ein bestätigter Live-Register/Login/Logout-Test; `OAUTH_PROVIDERS_JSON` ist nicht konfiguriert.


## Prüfprotokoll 2026-10-24

- GitHub-API-Prüfung: In diesem Server-Repository und im Frontend-Repository [`Sami20178/All-World-App-Source-Code-`](https://github.com/Sami20178/All-World-App-Source-Code-) sind die Release-Listen leer; die Git-Tag-Referenzabfragen liefern ebenfalls keine Tags. Es wurde kein Release und kein Tag erstellt.
- Nächste gemeinsame unveröffentlichte App-Version bleibt **First Classic 0.0.0.0**. Keine Version wurde übersprungen oder doppelt vergeben.
- Die Android-APK ist ein Frontend-Artefakt und kein Server-Binary: [Actions #40005689088](https://github.com/Sami20178/All-World-App-Source-Code-/actions/runs/40005689088), Artefakt-ID `12524470874`, Debug-APK, 22.048 Byte, Ablaufdatum 2026-11-22. Geräteinstallation/Kernfunktionstest sind nicht belegt.
- Die Konto-API ist deployed, aber externer HTTPS-Register/Login/Logout-Test ist offen; `OAUTH_PROVIDERS_JSON` ist nicht gesetzt. Kein Server-Release erstellt.
- Statusbericht: [PROJECT-PROGRESS-2026-10-24.md](PROJECT-PROGRESS-2026-10-24.md).

## APK-Nachtrag 2026-10-24 19:10 UTC

- Neuester belegter Android-Build: [Actions #40009492461](https://github.com/Sami20178/All-World-App-Source-Code-/actions/runs/40009492461), Commit be59ed399d692c297eaad182908cfc164f97389e.
- Artefakt First-Classic-0.0.0.0-Android-APK-debug, ID 12524789366, 22.070 Byte; Ablauf 2026-11-22 19:13 UTC. Build, Nicht-Leere, Signatur-/Integritätsprüfung und gebündelte Web-Assets erfolgreich.
- Keine echte Geräteinstallation oder Kernfunktionstests belegt. Das temporäre Debug-Artefakt ist kein Release-Asset. Die nächste freie gemeinsame Version bleibt First Classic 0.0.0.0; kein Release erstellt.



## Audit-Nachtrag 2026-10-25 — gemeinsamer Versionsstand

- Neuester Android-Build liegt im Frontend-Repository: [Actions #40214453328](https://github.com/Sami20178/All-World-App-Source-Code-/actions/runs/40214453328), Artefakt-ID `12606788167`, `First-Classic-0.0.0.0-Android-APK-debug`, 22.074 Byte; Ablauf 2026-11-24 17:02:35 UTC.
- Build, Nicht-Leere-, Signatur-/Integritäts- und Web-Asset-Prüfungen bestanden; echte Geräteinstallation/Kernfunktionstests sind nicht belegt. Das Artefakt gehört zur App, nicht zum Node.js-Server.
- Der Frontend-Deploy [#40214672480](https://github.com/Sami20178/All-World-App-Source-Code-/actions/runs/40214672480) hat den Deployment-Schritt übersprungen, weil `CLOUDFLARE_API_TOKEN` laut Workflow-Log nicht konfiguriert ist. Die neue API-Konfiguration ist nicht als live veröffentlicht bestätigt.
- Beide Haupt-Repositories haben keine Tags oder Releases. Nächste gemeinsame Version bleibt **First Classic 0.0.0.0**. Kein Release erstellt.


## Release-Gate-Nachprüfung 2026-10-26

- Die Release-Liste dieses Server-Repositories ist leer; das zugehörige Frontend-Repository hat ebenfalls keine veröffentlichten Releases. Die letzte dokumentierte Prüfung fand keine Tags; die Tag-Referenzabfrage in diesem Durchlauf gab über die GitHub-Integration 404.
- Die nächste gemeinsame Versionsbezeichnung bleibt First Classic 0.0.0.0. Es wurde kein Release und kein Tag erstellt.
- Backend-Node-Validierung [#40226053704](https://github.com/Sami20178/All-World-App/actions/runs/40226053704) war erfolgreich. Der Live-Smoke-Test [#40326895287](https://github.com/Sami20178/All-World-App/actions/runs/40326895287) war am 26.10.2026 um 13:00 UTC erfolgreich für den öffentlichen MCP-/OAuth-2.1-PKCE-Dienst und die Account-Auth-Endpunkte /api/health, /api/ready und /api/auth/providers.
- Der Live-Auth-Smoke-Test ist read-only; er bestätigt weder Registrierung/Login noch eine konfigurierte OAuth-Provider-Anmeldung. Provider-Erkennung meldete 0 konfigurierte Provider.
- Die Android-Debug-APK gehört zum Frontend-Repository und ist ein temporäres Actions-Artefakt, kein Release-Asset. Echte Geräteinstallation/Kernfunktionstests und die aktuelle Live-Frontend-Verifikation sind weiterhin offen. Daher kein Release erstellen.


## Audit-Nachtrag 2026-10-28 — Versionsstand und Release-Gate

- Der aktuelle Durchlauf konnte die vollständige Release- und Tag-Liste beider Haupt-Repositories nicht erneut abrufen: Die verfügbare GitHub-Integration bietet hier keine direkte Release-/Tag-Auflistungsaktion. Der letzte dokumentierte vollständige Release-Audit ist vom 2026-10-26. Daher ist `First Classic 0.0.0.0` weiterhin nur der **provisorische nächste Kandidat**, bis die aktuelle Liste unmittelbar vor Veröffentlichung erneut geprüft wurde.
- Frontend-Main-Commit: [4cf4417b0e72c000e3cb071ee4b795167a14f8de](https://github.com/Sami20178/All-World-App-Source-Code-/commit/4cf4417b0e72c000e3cb071ee4b795167a14f8de). Er wechselt die Android-WebView von `file://` auf die HTTPS-Frontend-Origin und schränkt WebView-Zugriffe ein. Der neue Android-Build und die zugehörigen Push-Workflow-Prüfungen wurden über die verfügbaren Tools nicht bestätigt.
- Cloudflare listet für den statischen Frontend-Worker das Deployment `79659901-bca8-41ae-a03e-cd13342442aa`, Version `1299741b-398e-4cb5-bebd-dcbf9d0ef661`, mit 100 % Traffic, erstellt 2026-10-28 19:50:18 UTC. Die direkte HTTP-/Browser-Prüfung scheiterte in dieser Tool-Umgebung an DNS-Auflösung; daher ist der konkrete Live-Inhalt nicht bestätigt.
- Die Konto-API zeigt `APP_ORIGIN` auf die exakte Frontend-Origin sowie D1 `AUTH_DB` und das Secret-Binding `RATE_LIMIT_SECRET`. Geheime Werte wurden nicht gelesen. Externe Live-Register/Login/Logout- und Cookie-/CORS-Tests bleiben offen.
- Es wurde kein Release und kein Tag erstellt. Das bekannte APK-Artefakt [Actions #40214453328](https://github.com/Sami20178/All-World-App-Source-Code-/actions/runs/40214453328) ist ein früheres temporäres Debug-Artefakt vor dem neuesten WebView-Commit, kein dauerhaftes Release-Asset und kein Nachweis eines Gerätetests.
- Der detaillierte Audit ist in [PROJECT-PROGRESS-2026-10-28.md](PROJECT-PROGRESS-2026-10-28.md) dokumentiert; die laufende Plattform-Matrix steht in [PLATFORM-MATRIX.md](PLATFORM-MATRIX.md).
- Release-Gate bleibt geschlossen: aktuelle Release-/Tag-Liste erneut prüfen, aktuellen Android-Build mit Signatur-/Asset-Prüfungen bestätigen, reale Android-/Fire-OS-Installation und Kernfunktionen testen sowie Live-Website/API-Fluss verifizieren.


## Nachtrag nach Merge von PR #23 — 2026-10-28

- Frontend-Main-Commit [7bb72f16a3e75bd7ff990ad62a88d455d6db4f06](https://github.com/Sami20178/All-World-App-Source-Code-/commit/7bb72f16a3e75bd7ff990ad62a88d455d6db4f06) übernimmt Space Grotesk für die Navigationskategorien und ersetzt positionsabhängige CSS-Selektoren durch explizite NORMAL/WORLD/CFW-Klassen.
- Die PR-Validierung [#40749562652](https://github.com/Sami20178/All-World-App-Source-Code-/actions/runs/40749562652) und der zugehörige CI-Lauf [#40749562840](https://github.com/Sami20178/All-World-App-Source-Code-/actions/runs/40749562840) waren erfolgreich. Im PR-Deployment-Lauf [#40749562720](https://github.com/Sami20178/All-World-App-Source-Code-/actions/runs/40749562720) waren Deployment und Live-Prüfung übersprungen, weil der Lauf durch einen Pull Request ausgelöst wurde.
- Das zuletzt gelistete Cloudflare-Deployment des Frontend-Workers ist von 2026-10-28 19:50:18 UTC und liegt vor dem Merge-Commit (20:04:01 UTC). Ein Post-Merge-Deployment und die sichtbare Live-Darstellung der Kategorien sind daher noch nicht bestätigt.
- Die Google-Fonts-CDN-Links bleiben bestehen; lokale WOFF2-Dateien und Lizenzhinweise sind weiterhin offen. Es wurde kein Release erstellt und die nächste Version wurde nicht vergeben.


## Cloudflare-Nachtrag nach Merge von PR #23 — 2026-10-28

- Nach dem Frontend-Merge-Commit [7bb72f16a3e75bd7ff990ad62a88d455d6db4f06](https://github.com/Sami20178/All-World-App-Source-Code-/commit/7bb72f16a3e75bd7ff990ad62a88d455d6db4f06) listet Cloudflare zwei neue Deployments des bestehenden Frontend-Workers: `b1d7ee5d-74df-4c6a-b1ca-d91f60cfd0f0` um 20:04:26 UTC und `f231cea2-cf92-4e19-842f-128e9c057ee3` um 20:06:20 UTC. Die neueste Version `01a393cb-07b8-49fb-b12b-29b4d2c0d965` (Version 146) steht auf 100 % Traffic.
- Die genaue Zuordnung eines Deployments zum GitHub-Commit ist durch die verfügbaren Run-Tools nicht belegt. Direkter HTTP-Abruf der Live-Website scheiterte weiterhin an DNS-Auflösung in der Prüfumgebung; sichtbare Kategorieänderungen gelten daher nicht als browserseitig bestätigt.
- Lokale WOFF2-Fonts und Lizenzhinweise sind weiterhin offen. Kein App-Release und kein Tag wurde erstellt; das Release-Gate bleibt geschlossen.


## Aktueller Audit 2026-10-30

- Release-/Tag-Stand erneut geprüft: Dieses Repository hat die Legacy-Release `All World` / Tag `All-World`; das Frontend-Repository hat keine Releases und keine Tags. Die Legacy-Release wird nicht umbenannt, nicht überschrieben und nicht als App-Version gezählt.
- Nächste passende gemeinsame Version bleibt **First Classic 0.0.0.0**. Kein Release/Tag dieser Version wurde erstellt.
- Neuester Server-Main-Commit: [77bbc838ba9c153e5070170489fce61410140a8f](https://github.com/Sami20178/All-World-App/commit/77bbc838ba9c153e5070170489fce61410140a8f), ergänzt Tests für nicht angemeldete private Account-Routen und abgelaufene Sitzungen.
- [PR #12](https://github.com/Sami20178/All-World-App/pull/12) wurde nach erfolgreichen Cloudflare-Auth-Worker-, Node-Server- und API-CI-Prüfungen gemergt. Die Post-Merge-Läufe #41116011422, #41116011560 und #41116011673 waren ebenfalls erfolgreich.
- Frontend-Deploy-Workflow wurde im Frontend-Repository korrigiert; [Deploy #41115090848](https://github.com/Sami20178/All-World-App-Source-Code-/actions/runs/41115090848) und [Frontend-Validierung #41115090940](https://github.com/Sami20178/All-World-App-Source-Code-/actions/runs/41115090940) waren erfolgreich. Das ist ein Web-Deploy, kein Node-Server-Deploy.
- Der Android-Build auf dem Frontend-Commit vor der Workflow-Korrektur wurde erfolgreich gebaut und signatur-/asset-geprüft, aber der Upload scheiterte zweimal am GitHub-Actions-Artefaktkontingent. Kein APK-Download, kein Geräte-/Fire-OS-Test und kein App-Release.
- Die Cloudflare-Konto-API ist in der Frontend-Konfiguration auf den vorhandenen Worker `all-world-auth-api` ausgerichtet. Geheimnisse wurden nicht gelesen. Der OAuth-Katalog ist keine Bestätigung, dass alle Anbieter aktiviert sind; jeder Provider benötigt eigene serverseitige Zugangsdaten und Callback-Prüfungen.
- Die Cloudflare-Zonen `allworld.com` und `allworld.dev` stehen auf `pending`; Custom-Worker-Domains sind nicht gelistet. Keine Domain-, DNS- oder TLS-Einstellungen geändert.
- Team-Server-Repository ist lesbar, aber Branch-Erstellung wurde mit 403 verweigert. Das angegebene Source-Code-Team-Repository ist über die Integration nicht auffindbar (404); keine Synchronisierung behauptet.
