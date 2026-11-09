#!/bin/sh
set -e
getent group mosisail >/dev/null || groupadd --system mosisail
id mosisail >/dev/null 2>&1 || useradd --system --gid mosisail --home-dir /var/lib/mosisail --create-home --shell /usr/sbin/nologin mosisail
install -d -m 0700 -o mosisail -g mosisail /var/lib/mosisail
systemctl daemon-reload >/dev/null 2>&1 || true
systemctl enable --now mosisail >/dev/null 2>&1 || true
