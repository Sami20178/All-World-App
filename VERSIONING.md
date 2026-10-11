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
- Server-Validierung erfolgreich: [Lauf #38121935678](https://github.com/Sami20178/All-World-App/actions/runs/38121935678), Commit `40c2e87aa0279d6b1c361129d06a43c8137e8342`.
- GitHub-Releases in diesem Repository: keine veröffentlicht.
- Release-Status: noch nicht veröffentlicht.
- APK: wird ausschließlich im Frontend-Repository aus dem Android-Projekt gebaut; erst nach Installations-/Kernfunktionstests als echtes Release-Asset verlinken. Der Server selbst ist keine APK.
- Die aktuelle Server-Dateispeicherung in JSON und der In-Memory-Session-Store sind Starter-Konfigurationen, nicht für öffentlichen Produktionseinsatz ausreichend.

## Release-Regeln

- Release-Titel, Versionsnummer, Änderungsprotokoll und Status mit dem Frontend abstimmen.
- Keine Versionsnummer doppelt vergeben oder bestehende Releases überschreiben.
- Ein gemeinsamer App-Release darf erst als veröffentlicht bezeichnet werden, wenn eine echte, erfolgreich gebaute und angemessen geprüfte Android-APK vorhanden ist und die zugehörigen Release-Assets/Links tatsächlich funktionieren.
- Der Server-Release dokumentiert die Server-Änderungen und verweist auf die passende Frontend-Release. APK/AAB dürfen nur als echte Build-Dateien angehängt werden, nicht als Platzhalter.
- Keine Geheimnisse, Tokens, `.env`-Dateien oder Nutzerdaten einchecken.
