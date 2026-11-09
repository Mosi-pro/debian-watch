#!/usr/bin/env bash
# MosiDeck Installer (Debian/Ubuntu mit systemd).
#   curl -fsSL https://raw.githubusercontent.com/Mosi-pro/debian-watch/main/deploy/install.sh | sudo bash
# Optional: MOSIDECK_VERSION=v1.2.3 fuer eine feste Version.
set -euo pipefail

REPO="Mosi-pro/debian-watch"
[ "$(id -u)" = 0 ] || { echo "Bitte mit sudo/root ausfuehren." >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemd wird benoetigt." >&2; exit 1; }
for c in curl tar sha256sum; do command -v "$c" >/dev/null || { echo "$c fehlt (apt install $c)." >&2; exit 1; }; done

case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Architektur $(uname -m) wird nicht unterstuetzt." >&2; exit 1 ;;
esac

TAG="${MOSIDECK_VERSION:-}"
if [ -z "$TAG" ]; then
  TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -m1 '"tag_name"' | cut -d'"' -f4)
fi
[ -n "$TAG" ] || { echo "Kein Release gefunden." >&2; exit 1; }
VER="${TAG#v}"
ARCHIVE="mosideck_${VER}_linux_${ARCH}.tar.gz"
BASE="https://github.com/$REPO/releases/download/$TAG"

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
echo "==> Lade MosiDeck $TAG ($ARCH)"
curl -fsSL -o "$TMP/$ARCHIVE" "$BASE/$ARCHIVE"
curl -fsSL -o "$TMP/checksums.txt" "$BASE/checksums.txt"
( cd "$TMP" && grep " $ARCHIVE\$" checksums.txt | sha256sum -c - ) || { echo "Pruefsumme falsch, Abbruch." >&2; exit 1; }
tar -xzf "$TMP/$ARCHIVE" -C "$TMP"

getent group mosideck >/dev/null || groupadd --system mosideck
id mosideck >/dev/null 2>&1 || useradd --system --gid mosideck --home-dir /var/lib/mosideck --create-home --shell /bin/bash mosideck
install -d -m 0700 -o mosideck -g mosideck /var/lib/mosideck
install -d -m 0755 /etc/mosideck
install -m 0755 "$TMP/mosideck" /usr/local/bin/mosideck
[ -f /etc/mosideck/config.toml ] || install -m 0644 "$TMP/deploy/config.toml" /etc/mosideck/config.toml
install -m 0644 "$TMP/deploy/mosideck.service" /etc/systemd/system/mosideck.service

systemctl daemon-reload
systemctl enable mosideck >/dev/null
systemctl restart mosideck

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
cat <<MSG

MosiDeck $TAG laeuft.
  Oeffnen:  https://${IP:-<server-ip>}:8443   (Zertifikat ist self-signed: /var/lib/mosideck/mosideck.crt)
  Name:     DNS-Eintrag mosi.homelab -> ${IP:-<server-ip>} im Router/Pi-hole anlegen
  Setup:    Beim ersten Aufruf Admin-Benutzer im Browser anlegen
  Update:   sudo mosideck update && sudo systemctl restart mosideck
MSG
