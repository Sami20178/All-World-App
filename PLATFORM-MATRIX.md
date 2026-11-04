# All World — laufende Plattform-Matrix

**Stand:** 2026-11-04, 19:19 CET. Statusangaben beruhen auf aktuellen GitHub-Workflows und Cloudflare-Metadaten. „Live bestätigt“ gilt nur für den ausdrücklich geprüften Web-Workflow. Ein erfolgreicher CI-Lauf ist kein Geräteinstallationstest.

| Plattform | Status | Zielartefakt / Architektur | Build-Anforderungen | Nachweis und Testergebnis | Nächster Schritt |
|---|---|---|---|---|---|
| Web | **Deployed und live verifiziert** | Statische HTML/CSS/JS-Website über Worker `all-world-app-source-code`; bestehende workers.dev-Adresse | Frontend-Deploy [#41708169935](https://github.com/Sami20178/All-World-App-Source-Code-/actions/runs/41708169935) und Validierung #41708170121 erfolgreich. Cloudflare-Deployment `f0b162d0-d046-45a0-b2a4-7cadb69923d7`, Version `a239ac1e-04d9-4e6a-9408-a5d671056480`, 100 % Traffic; Live-Verify im Actions-Runner erfolgreich. || PWA | Implementierte Dateien vorhanden; Installation und Offline-Modus **nicht getestet** | Web-App-Manifest und Service Worker; kein separates natives Paket | Site-Bundle und PWA-Dateivalidierung | Die Dateien wurden im Site-Bundle geprüft. Kein echter Installationsdialog-, Offline-, Push- oder Browser-Gerätetest belegt. | Installation und Offline-Fallback in realen Browsern und auf Mobilgeräten testen. |
| Android | **Debug-APK gebaut und Integritäts-/Signaturprüfung bestanden; Gerätetest offen** | Paket `com.allworld.app`; minSdk 23, targetSdk 28; kein ABI-Filter in `android/app/build.gradle`; tatsächliche Geräte-/Architekturkompatibilität nicht nachgewiesen | Android Gradle Plugin 8.7.3, compileSdk 35, Gradle/Java gemäß CI | Build [#41695790568](https://github.com/Sami20178/All-World-App-Source-Code-/actions/runs/41695790568) erfolgreich. Debug-Artefakt `First-Classic-0.0.0.0-Android-APK-debug`, ID `13260417885`, 32.462 Byte. Build, Nichtleer-, Signatur- und Web-Asset-Prüfungen bestanden. Keine echte Installation. | APK auf einem echten Android-Gerät installieren und Start, Navigation, Anmeldung, Netzwerkfehler und WebView prüfen; erst danach Release-Signierung vorbereiten. |
| Fire OS / Amazon Fire HD 8, HD 10, Fire Max | **Geplant; nicht getestet** | Dieselbe Android-APK, falls Kompatibilität bestätigt wird; keine künstliche separate Fire-Datei | Fire-OS-Version, Android-API, WebView, CPU-Architektur und Amazon-/Google-Play-Abhängigkeiten je Gerät erfassen | Kein echter Fire-Tablet-Test. Für das bekannte Fire HD 10 liegt als früherer Gerätehinweis Fire OS 7.3.3.1 / Android 9 / API 28 / ARM64-v8a vor; in diesem Lauf nicht erneut am Gerät geprüft. Fire HD 8 und Fire Max ebenfalls nicht getestet. | APK auf dem tatsächlichen Fire HD 10 testen; HD 8/Fire Max nur mit real verfügbaren Geräten prüfen. |
| Windows | **Nicht gebaut / nicht getestet** | EXE/MSI nur nach Auswahl einer nativen Desktop-Hülle; Web/PWA getrennt ausweisen | Windows-Runner, Paketierung, Signatur und Starttest | Kein Windows-Artefakt und kein Starttest belegt. | PWA gegenüber nativer Hülle bewerten; nur echte Builds veröffentlichen. |
| macOS | **Blockiert / nicht gebaut** | DMG/PKG oder signierte native App | macOS/Xcode, Apple-Signierung und geeignete Build-Berechtigung | Kein macOS-Build, Zertifikat oder Starttest belegt. | macOS-Build-Umgebung und Signierung bereitstellen. |
| Linux | **Nicht gebaut / nicht getestet** | AppImage/DEB/RPM nur für eine gewählte native Hülle; ARM64/x86_64 getrennt prüfen | Linux-Runner und Paketierungs-/Starttests | Kein Linux-Paket und kein Starttest belegt. | Zielarchitektur und Paketformat festlegen, dann echte Builds testen. |
| iOS/iPadOS | **Blockiert / nicht gebaut** | Signierte iOS-App; APK ist nicht kompatibel | macOS/Xcode, Apple-Zertifikate und Provisioning | Kein iOS-Build, keine Signatur und kein Gerätetest belegt. | Erst mit autorisierter Apple-Build-Umgebung beginnen. |
| Nintendo Switch | **Nicht verfügbar; keine Portierung** | Eigenständige, legale Konsolen-Portierung; Android-APK ist kein Konsolenpaket | Zulässige Entwicklungsumgebung, passende Runtime, Grafik-/Input-Port und Hardware | Kein Build und kein Hardwaretest. | Separate Machbarkeitsprüfung ohne Schutzumgehung oder geschützte Firmware-/Spieldateien. |
| Wii U | **Nicht verfügbar; keine Portierung** | Eigenständiges Konsolenartefakt, falls technisch sinnvoll | Passende Toolchain, Architektur-/Runtime-Port und Hardwaretest | Kein Build und kein Hardwaretest. | Separate Machbarkeitsprüfung. |
| Wii | **Nicht verfügbar; keine Portierung** | Eigenständiges Konsolenartefakt, falls technisch sinnvoll | Passende Toolchain, Grafik-/Input-Port und Hardwaretest | Kein Build und kein Hardwaretest. | Separate Machbarkeitsprüfung. |
| GameCube | **Nicht verfügbar; keine Portierung** | Eigenständiges Konsolenartefakt, falls technisch sinnvoll | Passende Toolchain, Laufzeit-/Grafik-/Input-Port und Hardwaretest | Kein Build und kein Hardwaretest. | Separate Machbarkeitsprüfung. |

## Gemeinsame Release- und Betriebs-Gates

- Nächster unvergebener Kandidat: **First Classic 0.0.0.0**. Frontend-Releases und -Tags sind leer. Im Server existiert nur die Legacy-Release `All World` / Tag `All-World`; sie wird nicht umbenannt oder als Schema-Version gezählt.
- Kein App-Release ohne echte APK, passende Release-Signierung, Integritätsprüfung und angemessene Kernfunktionstests. Der aktuelle APK-Download ist ein temporäres Debug-Artefakt, kein Release-Asset.
- Die Android-APK wurde nicht auf realer Hardware installiert. Fire OS ist nicht getestet. Die Plattformen Windows, macOS, Linux und iOS/iPadOS wurden nicht gebaut. Keine Konsolen-Portierung wurde erstellt.
- Ein erfolgreicher Web-Deploy ist kein Android- oder Server-Release. Ein Team-Mirror-Deploy-Workflow, dessen Deploy-/Live-Schritte übersprungen wurden, ist kein Produktionsdeployment.
- Google-Fonts-CDN-Abhängigkeiten bestehen weiterhin; lokal eingebundene WOFF2-Dateien samt Lizenzhinweisen sind offen (Frontend-Issue #27).
- Cloudflare-Zonen `allworld.com` und `allworld.dev` stehen auf `pending`. Worker-Custom-Domain- und Pages-Projektlisten sind leer. Bestehende Website-/E-Mail-DNS-Einträge wurden nicht geändert.
- Auth-Preview-Worker `all-world-auth-api-preview` ist deployed; Preview-Smoke #41705964821 bestand mit synthetischen Daten. Das `workers.dev`-Subdomain-Binding ist aktiviert, Versions-Preview-URLs sind deaktiviert; ein öffentlicher Browser-/Route-Test wurde nicht ausgeführt. Das Binding `RATE_LIMIT_SECRET` ist vorhanden; Secret-Werte wurden nicht gelesen. Produktions-Auth-Worker und Produktions-D1 wurden nicht geändert.
- Team-Source-Main steht auf `e091a714a1385aa8f1082dcad289898fbed6c855`; PR #15 enthält die aktuelle Dokumentations-/Preview-Synchronisierung. Die historischen Deployment-IDs wurden im PR-Branch korrigiert; Codex-Re-Review läuft. Team-Server-Mirror stimmt bei den geprüften Serverdateien sowie `VERSIONING.md` und `PLATFORM-MATRIX.md` mit Upstream überein.

## Historische Statusnachträge

Der vorherige Matrixstand vom 28.10.2026 wurde durch die obige aktuelle Matrix ersetzt. Ältere Statusnachträge bleiben zur Nachvollziehbarkeit erhalten.

## Statusnachtrag 2026-10-30

| Plattform | Status | Nachweis / Einschränkung |
|---|---|---|
| Web / Cloudflare Worker | deployed; begrenzte Live-Routenprüfung bestanden | Frontend-Workflow #41115090848 deployte den statischen Worker; die Route-/Inhaltsprüfungen bestanden. Kein Node.js-Server-Deploy daraus ableiten. |
| Android | Debug-APK gebaut und geprüft; nicht als Download verfügbar | Build und Signatur-/Web-Asset-Prüfungen erfolgreich; GitHub-Artefakt-Upload scheiterte am ausgeschöpften Speicherquota. Kein Release-Asset, kein Gerätetest. |
| Fire OS | geplant, nicht getestet | Fire HD 8/10/Fire Max nicht auf echter Hardware geprüft. |
| Windows / macOS / Linux | nicht gebaut | Keine Desktop-Pakete oder Hardwaretests belegt. |
| iOS/iPadOS | blockiert/nicht gebaut | Apple-Build-Werkzeuge, Zertifikate und Signierung fehlen in dieser Ausführung. |
| Konsolen | separate Machbarkeitsprüfung offen | Kein Switch-/Wii-U-/Wii-/GameCube-Build oder Hardwaretest. |

Die Web/PWA-Quelle ist vorhanden; Offline-, Browser-, Barrierefreiheits- und responsives Verhalten sind noch nicht vollständig getestet. Lokale WOFF2-Fonts und Lizenzhinweise sind offen. Eine eigene Domain wurde nicht eindeutig zugeordnet: beide vorhandenen Zonen stehen auf `pending`; keine DNS-Änderungen.


## Nachprüfung 2026-11-04

- Server-Main `ac20ba680826ca0df232da2c798b1bbc0335b942`; API-CI #41705964720, Node-Validierung #41705964504, Auth-Worker-Validierung #41705964821 und geplanter API/Auth/MCP-Smoke #41784724713 erfolgreich.
- Team-Server-Main `92b424e74f26ea032b02ef8c6e155179347b9d58`; geplanter API/Auth/MCP-Smoke #41784786015 erfolgreich. `VERSIONING.md` und `PLATFORM-MATRIX.md` waren vor dieser Aktualisierung per Blob-SHA identisch zum Upstream.
- Aktueller Frontend-Worker: Deployment `f0b162d0-d046-45a0-b2a4-7cadb69923d7`, Version `a239ac1e-04d9-4e6a-9408-a5d671056480`, 100 % Traffic. Keine Worker-Custom-Domain und kein Pages-Projekt; `allworld.com` und `allworld.dev` bleiben `pending`.
- Android: Debug-APK-Build #41695790568 erfolgreich, Artefakt `13260417885`, 32.462 Byte; kein echter Gerätetest. Fire OS ist nicht getestet. Windows, macOS, Linux und iOS/iPadOS wurden nicht gebaut; keine Konsolen-Portierung.
- Lokale WOFF2-Fonts fehlen weiterhin; Issue #27 bleibt offen. Es wurden keine Platzhalterdateien oder unlizenzierte Assets angelegt.
- Keine neue App-Version, kein Versions-Tag und kein Release. Nächster Kandidat bleibt `First Classic 0.0.0.0`.