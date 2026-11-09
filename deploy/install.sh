#!/usr/bin/env bash
# Installer fuer MosiDeck (Homelab-Cockpit) und MosiSail (Segel-Cockpit) -- Debian/Ubuntu mit systemd.
#   MosiDeck: curl -fsSL https://raw.githubusercontent.com/Mosi-pro/debian-watch/main/deploy/install.sh | bash
#   MosiSail: curl -fsSL https://raw.githubusercontent.com/Mosi-pro/debian-watch/main/deploy/install.sh | bash -s -- mosisail
# (als root; mit sudo: ... | sudo bash ...)
# Optional: MOSIDECK_VERSION=v1.2.3 fuer eine feste Version, MOSIDECK_REF=<branch|commit> fuer den Quellcode-Build.
set -euo pipefail

REPO="Mosi-pro/debian-watch"
APP="${1:-mosideck}"
case "$APP" in mosideck|mosisail) ;; *) echo "Unbekannte App '$APP' (mosideck oder mosisail)." >&2; exit 1 ;; esac
[ "$(id -u)" = 0 ] || { echo "Bitte mit sudo/root ausfuehren." >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemd wird benoetigt." >&2; exit 1; }
for c in curl tar sha256sum; do command -v "$c" >/dev/null || { echo "$c fehlt (apt install $c)." >&2; exit 1; }; done

case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Architektur $(uname -m) wird nicht unterstuetzt." >&2; exit 1 ;;
esac

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
GO_VERSION="1.26.0"
REF="${MOSIDECK_REF:-main}"

# 1) Fertiges Release (schnell) -- 2) sonst direkt aus dem Quellcode bauen
TAG="${MOSIDECK_VERSION:-}"
if [ -z "$TAG" ]; then
  TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null | grep -m1 '"tag_name"' | cut -d'"' -f4 || true)
fi

if [ -n "$TAG" ]; then
  VER="${TAG#v}"
  ARCHIVE="${APP}_${VER}_linux_${ARCH}.tar.gz"
  BASE="https://github.com/$REPO/releases/download/$TAG"
  echo "==> Lade $APP $TAG ($ARCH)"
  curl -fsSL -o "$TMP/$ARCHIVE" "$BASE/$ARCHIVE"
  curl -fsSL -o "$TMP/checksums.txt" "$BASE/checksums.txt"
  ( cd "$TMP" && grep " $ARCHIVE\$" checksums.txt | sha256sum -c - ) || { echo "Pruefsumme falsch, Abbruch." >&2; exit 1; }
  tar -xzf "$TMP/$ARCHIVE" -C "$TMP"
  BIN="$TMP/$APP"; DEPLOY="$TMP/deploy"
else
  echo "==> Noch kein Release vorhanden, baue aus dem Quellcode ($REF) -- dauert ca. 1-2 Minuten"
  GOBIN_PATH=""
  if command -v go >/dev/null 2>&1; then
    HAVE=$(go env GOVERSION 2>/dev/null | sed 's/^go//')
    if [ -n "$HAVE" ] && [ "$(printf '%s\n%s\n' "$GO_VERSION" "$HAVE" | sort -V | head -1)" = "$GO_VERSION" ]; then
      GOBIN_PATH="$(command -v go)"
    fi
  fi
  if [ -z "$GOBIN_PATH" ]; then
    GOTGZ="go${GO_VERSION}.linux-${ARCH}.tar.gz"
    curl -fsSL -o "$TMP/$GOTGZ" "https://dl.google.com/go/$GOTGZ"
    ( cd "$TMP" && echo "$(curl -fsSL "https://dl.google.com/go/$GOTGZ.sha256")  $GOTGZ" | sha256sum -c - >/dev/null ) \
      || { echo "Go-Pruefsumme falsch, Abbruch." >&2; exit 1; }
    tar -xzf "$TMP/$GOTGZ" -C "$TMP"          # temporaer, wird danach geloescht
    GOBIN_PATH="$TMP/go/bin/go"
  fi
  curl -fsSL "https://github.com/$REPO/archive/$REF.tar.gz" | tar -xz -C "$TMP"
  SRC=$(echo "$TMP"/debian-watch-*)
  ( cd "$SRC" && GOTOOLCHAIN=local GOCACHE="$TMP/gocache" GOPATH="$TMP/gopath" CGO_ENABLED=0 \
      "$GOBIN_PATH" build -trimpath -ldflags "-s -w -X main.version=$REF" -o "$TMP/$APP" ./cmd/$APP )
  BIN="$TMP/$APP"; DEPLOY="$SRC/deploy"
  TAG="$REF"
fi

if [ "$APP" = mosisail ]; then SHELL_BIN=/usr/sbin/nologin; else SHELL_BIN=/bin/bash; fi
getent group "$APP" >/dev/null || groupadd --system "$APP"
id "$APP" >/dev/null 2>&1 || useradd --system --gid "$APP" --home-dir "/var/lib/$APP" --create-home --shell "$SHELL_BIN" "$APP"
install -d -m 0700 -o "$APP" -g "$APP" "/var/lib/$APP"
install -d -m 0755 "/etc/$APP"
install -m 0755 "$BIN" "/usr/local/bin/$APP"
[ -f "/etc/$APP/config.toml" ] || install -m 0644 "$DEPLOY/$APP.config.toml" "/etc/$APP/config.toml"
install -m 0644 "$DEPLOY/$APP.service" "/etc/systemd/system/$APP.service"

systemctl daemon-reload
systemctl enable "$APP" >/dev/null
systemctl restart "$APP"

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ "$APP" = mosisail ]; then
cat <<MSG

MosiSail $TAG laeuft.
  Oeffnen:  https://mosi.sail  (oder https://${IP:-<server-ip>})
  Name:     DNS-Eintrag  mosi.sail -> ${IP:-<server-ip>}  im Router / Pi-hole anlegen
  Zertifikat: self-signed, liegt unter /var/lib/mosisail/mosisail.crt (auf Geraeten als vertrauenswuerdig installierbar)
  Setup:    Beim ersten Aufruf Benutzer im Browser anlegen
  Update:   Installer-Befehl einfach erneut ausfuehren
MSG
else
cat <<MSG

MosiDeck $TAG laeuft.
  Oeffnen:  https://${IP:-<server-ip>}:8443   (Zertifikat ist self-signed: /var/lib/mosideck/mosideck.crt)
  Name:     DNS-Eintrag mosi.homelab -> ${IP:-<server-ip>} im Router/Pi-hole anlegen
  Setup:    Beim ersten Aufruf Admin-Benutzer im Browser anlegen
  Update:   Installer-Befehl einfach erneut ausfuehren
MSG
fi
