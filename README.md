# MosiDeck

Homelab-Cockpit als **ein einziges Go-Binary**: Login (optional 2FA), Web-Terminal und Live-Auslastung.
Keine Datenbank, keine Laufzeit-Abhängigkeiten, Frontend ist eingebettet (`go:embed`, xterm.js mitgeliefert, kein CDN).

## Installation (Debian/Ubuntu, systemd)

```bash
curl -fsSL https://raw.githubusercontent.com/Mosi-pro/debian-watch/main/deploy/install.sh | sudo bash
```

Das Script lädt das passende Release (amd64/arm64), prüft die SHA-256-Summe, legt den Systembenutzer `mosideck`,
`/etc/mosideck/config.toml` und die systemd-Unit an und startet den Dienst.
Beim ersten Aufruf von `https://<server-ip>:8443` legst du im Browser den Admin an.

Alternativen: `.deb` aus den Releases (`apt install ./mosideck_*.deb`) oder Docker
(`deploy/docker-compose.yml`, Image `ghcr.io/mosi-pro/debian-watch`; Terminal = Shell im Container).

**Update:** `sudo mosideck update && sudo systemctl restart mosideck`

## Erreichbar unter mosi.homelab

Der Name ist nur ein DNS-Eintrag: `mosi.homelab → Server-IP` im Router (Fritz!Box: Heimnetz → Netzwerk → Gerät),
in dnsmasq/Pi-hole, oder per `hosts`-Datei. Mit Avahi geht auch `mosi.local`.

HTTPS: Standardmäßig erzeugt MosiDeck ein Self-Signed-Zertifikat für `hostname` und alle lokalen IPs
(`/var/lib/mosideck/mosideck.crt`, auf Clients als vertrauenswürdig installierbar). Alternativ eigenes Zertifikat
(`tls_cert`/`tls_key`, z. B. von Caddy mit interner CA) oder `disable_tls = true` hinter einem Reverse-Proxy
(dann `trust_proxy = true`). Optionaler Redirect von Port 80: `redirect_http = "0.0.0.0:80"`.

## Funktionen

- **Dashboard:** CPU, RAM/Swap, Disk `/`, Netzwerk, Temperatur, Uptime/Load, Top-Prozesse; Live per SSE (2 s),
  Verlauf der letzten Stunde als Ringpuffer im RAM.
- **Terminal:** echte PTY-Shell per WebSocket, Tabs, Copy/Paste, Resize (vim, htop, tmux funktionieren).
- **Einstellungen:** Benutzer verwalten, Passwort ändern, TOTP-2FA, Audit-Log.
- **CLI:** `mosideck serve | passwd <user> | update | version`

## Sicherheit

Ein Web-Terminal ist eine Fernsteuerung des Servers. Eingebaut:

- Passwörter mit **argon2id**, Sessions als `HttpOnly`/`SameSite=Strict`/`Secure`-Cookie, serverseitig widerrufbar.
- **TOTP** (RFC 6238) mit Replay-Schutz. Rate-Limit je IP (10) und je Benutzer (5) mit 5 min Sperre.
- **Audit-Log** (`/var/lib/mosideck/audit.log`): Setup, Logins/Fehlversuche, Terminal-Start/-Ende, Benutzeränderungen.
- **Nur LAN:** Anfragen von nicht-privaten IPs (nicht Loopback/RFC1918/Link-Local/CGNAT für WireGuard/Tailscale)
  werden abgelehnt. Niemals direkt ins Internet freigeben, von außen nur über WireGuard.
- Terminal läuft als der Dienst-Benutzer `mosideck`, **nicht als root**; der Start als root wird verweigert
  (`allow_root = true` hebt das auf). Root nur per `sudo` im Terminal: dafür `mosideck` bewusst in die sudoers aufnehmen.
- Origin-Check für alle schreibenden Requests und WebSockets, CSRF-Token, CSP und weitere Security-Header.

## Entwicklung

```bash
go test ./...
go build -o mosideck ./cmd/mosideck
# lokal, ohne TLS, Terminal als aktueller Benutzer:
printf 'listen = "127.0.0.1:8443"\ndata_dir = "./data"\ndisable_tls = true\n' > dev.toml
./mosideck -c dev.toml serve
```

Releases: Tag `vX.Y.Z` pushen. GitHub Actions baut mit GoReleaser Binaries (amd64/arm64), `.deb` und `checksums.txt`
sowie das Docker-Image nach GHCR.

## Bewusst noch nicht enthalten

- **SQLite-Langzeitverlauf** (7–30 Tage): aktuell nur Ringpuffer im RAM (1 h). Benutzer liegen in `users.json` (0600).
- **QR-Code** für 2FA: der Schlüssel wird als Text/otpauth-URI angezeigt.
- Passkeys/WebAuthn, Update-Button im UI (Update per CLI), Caddy-Integration.
