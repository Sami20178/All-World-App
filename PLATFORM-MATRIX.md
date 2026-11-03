# All World — laufende Plattform-Matrix

**Stand:** 2026-11-03, 20:01 CET. Statusangaben beruhen auf aktuellen GitHub-Workflows und Cloudflare-Metadaten. „Live bestätigt“ gilt nur für den ausdrücklich geprüften Web-Workflow. Ein erfolgreicher CI-Lauf ist kein Geräteinstallationstest.

| Plattform | Status | Zielartefakt / Architektur | Build-Anforderungen | Nachweis und Testergebnis | Nächster Schritt |
|---|---|---|---|---|---|
| Web | **Deployed und live verifiziert** | Statische HTML/CSS/JS-Website über Worker `all-world-app-source-code`; öffentliche Adresse ist die vorhandene workers.dev-URL | Node.js 22, Site-Bundle-Build, bestehender Wrangler-Workflow | Frontend-Deploy [#41695790678](https://github.com/Sami20178/All-World-App-Source-Code-/actions/runs/41695790678) und HTTPS-Live-Verify erfolgreich. Cloudflare-Deployment `e853e422-e27a-4f19-8fd2-a6417ba6caeb`, Version `2fb9aef7-df40-4a53-b356-382b9ac764a4`, 100 % Traffic. | Nach dem aktuellen Dokumentations-Commit den neuen Deploy erneut prüfen; responsive Ansichten, Barrierefreiheit und Browserkonsole weiter testen. |
| PWA | Implementierte Dateien vorhanden; Installation und Offline-Modus **nicht getestet** | Web-App-Manifest und Service Worker; kein separates natives Paket | Site-Bundle und PWA-Dateivalidierung | Die Dateien wurden im Site-Bundle geprüft. Kein echter Installationsdialog-, Offline-, Push- oder Browser-Gerätetest belegt. | Installation und Offline-Fallback in realen Browsern und auf Mobilgeräten testen. |
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
- Auth-Preview-Script `all-world-auth-api-preview` wurde hochgeladen, aber workers.dev und Preview-URLs sind deaktiviert. D1 `all-world-auth-preview` ist leer. Das erforderliche Secret-Binding `RATE_LIMIT_SECRET` fehlt; Live-Smoke bleibt blockiert. Produktions-Auth-Worker und Produktions-D1 wurden nicht geändert.
- Team-Source-Mirror ist auf Commit `7567eb0` synchronisiert; Team-Server-Mirror stimmt bei `server.js`, `package.json`, Auth-Worker, Schema und Versionsregister mit Upstream überein.

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

