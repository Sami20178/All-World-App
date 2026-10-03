#!/usr/bin/env bash
set -euo pipefail

# connect-vscode-repo.sh
# Dieses Skript verbindet dein lokales VS Code Projekt mit dem GitHub-Repo
# https://github.com/Sami20178/WorldNX
# Ablauf: remote setzen (falls noch nicht), alle Dateien committen und in einen neuen Branch pushen.

REPO_URL_SSH="git@github.com:Sami20178/WorldNX.git"
REPO_URL_HTTPS="https://github.com/Sami20178/WorldNX.git"

echo "== VS Code -> GitHub Sync Script =="

# Prüfe auf git
if ! command -v git >/dev/null 2>&1; then
  echo "Fehler: git ist nicht installiert. Bitte installiere git und versuche es erneut." >&2
  exit 1
fi

# Stelle sicher, dass wir in einem Verzeichnis sind
WORKDIR="$PWD"
echo "Arbeitsverzeichnis: $WORKDIR"

# Bestimme default connection
read -p "Verbindungsart wählen (ssh/https) [ssh]: " METHOD
METHOD=${METHOD:-ssh}

if [ "$METHOD" = "ssh" ]; then
  DEFAULT_REMOTE="$REPO_URL_SSH"
else
  DEFAULT_REMOTE="$REPO_URL_HTTPS"
fi

# Falls kein git repo initialisiert ist, initialisiere es
if [ ! -d ".git" ]; then
  read -p "Kein Git-Repository gefunden. Soll ich hier ein neues Git-Repository initialisieren? (j/n) [j]: " INIT
  INIT=${INIT:-j}
  if [[ "$INIT" =~ ^(j|J) ]]; then
    git init
    echo "Initialisiertes leeres Git-Repository." 
  else
    echo "Abbruch."; exit 1
  fi
fi

# Prüfe remote origin
if git remote get-url origin >/dev/null 2>&1; then
  CURRENT_REMOTE=$(git remote get-url origin)
  echo "Aktueller remote 'origin': $CURRENT_REMOTE"
  read -p "Soll ich origin auf $DEFAULT_REMOTE setzen und überschreiben? (j/n) [n]: " OVERWRITE
  OVERWRITE=${OVERWRITE:-n}
  if [[ "$OVERWRITE" =~ ^(j|J) ]]; then
    git remote remove origin || true
    git remote add origin "$DEFAULT_REMOTE"
    echo "origin wurde auf $DEFAULT_REMOTE gesetzt."
  else
    echo "Behalte bestehenden origin." 
  fi
else
  git remote add origin "$DEFAULT_REMOTE"
  echo "origin gesetzt auf: $DEFAULT_REMOTE"
fi

# SSH Hinweis
if [ "$METHOD" = "ssh" ]; then
  if [ ! -f "$HOME/.ssh/id_ed25519" ] && [ ! -f "$HOME/.ssh/id_rsa" ]; then
    echo "Kein SSH-Key gefunden. Ich kann einen neuen ed25519-Key erzeugen." 
    read -p "SSH-Key erzeugen? (j/n) [j]: " GEN
    GEN=${GEN:-j}
    if [[ "$GEN" =~ ^(j|J) ]]; then
      mkdir -p "$HOME/.ssh"
      ssh-keygen -t ed25519 -f "$HOME/.ssh/id_ed25519" -N "" -C "$(git config user.email || echo 'no-email')"
      echo "SSH-Key erzeugt. Bitte füge den Inhalt von ~/.ssh/id_ed25519.pub in GitHub -> Settings -> SSH and GPG keys hinzu." 
      echo "Inhalt des öffentlichen Schlüssels:"; echo "----------------"; cat "$HOME/.ssh/id_ed25519.pub"; echo "----------------"
      read -p "Drücke Enter, wenn du den Key in GitHub eingefügt hast..." dummy
    else
      echo "Weiter ohne SSH-Key-Erzeugung. Pushes via SSH werden fehlschlagen wenn kein Key vorhanden ist." 
    fi
  fi
fi

# Hole remote-Informationen
echo "Hole remote Referenzen..."
git fetch origin --prune || true

# Bestimme Default-Branch des Remotes falls vorhanden
DEFAULT_BRANCH="main"
if git remote show origin 2>/dev/null | grep "HEAD branch" >/dev/null 2>&1; then
  DEFAULT_BRANCH=$(git remote show origin | sed -n '/HEAD branch/s/.*: //p' || echo "main")
fi

echo "Vorgeschlagener Default-Branch: $DEFAULT_BRANCH"

# Erstelle einen neuen Feature-Branch für den ersten Push
read -p "Name des lokalen Branches, der gepusht werden soll [feature/sync-from-vscode]: " BRANCH
BRANCH=${BRANCH:-feature/sync-from-vscode}

git add -A

# Prüfe ob es etwas zu committen gibt
if git diff --cached --quiet; then
  echo "Keine Änderungen zum Committen gefunden. Überspringe Commit." 
else
  read -p "Commit-Message für alle aktuellen Änderungen [Initial commit from VSCode]: " CM
  CM=${CM:-Initial commit from VSCode}
  git commit -m "$CM"
  echo "Geändert: Commit erstellt."
fi

# Falls lokaler Branch nicht existiert, erstelle und wechsle
git checkout -B "$BRANCH"

# Push: setze upstream
echo "Pushen nach origin/$BRANCH ..."
if git push -u origin "$BRANCH"; then
  echo "Erfolgreich gepusht." 
else
  echo "Push schlug fehl. Versuche detaillierte Fehlermeldung." 
  git push -u origin "$BRANCH" --force || true
fi

echo
cat <<EOF
Fertig.
- Öffne jetzt VS Code (falls nicht geöffnet) mit 'code .' oder benutze die geöffnete Instanz.
- In VS Code: Source Control öffnen (Icon links) -> Du solltest deine Änderungen sehen.
- Für zukünftige Änderungen: git add/commit/push oder nutze die Source Control GUI.

Wichtig: Falls das Repo bereits entfernte Dateien enthält, prüfe Pull/Merge-Konflikte:
  git pull --rebase origin $DEFAULT_BRANCH
  git push

EOF
