#!/bin/sh
set -e
getent group mosideck >/dev/null || groupadd --system mosideck
id mosideck >/dev/null 2>&1 || useradd --system --gid mosideck --home-dir /var/lib/mosideck --create-home --shell /bin/bash mosideck
install -d -m 0700 -o mosideck -g mosideck /var/lib/mosideck
systemctl daemon-reload >/dev/null 2>&1 || true
systemctl enable --now mosideck >/dev/null 2>&1 || true
