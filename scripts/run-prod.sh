#!/usr/bin/env bash
# Loads the app env and starts the SvelteKit (adapter-node) server. Used by the systemd unit so
# quoted values in apps/web/.env are handled correctly (systemd EnvironmentFile can't parse them).
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
set -a
[ -f apps/web/.env ] && . apps/web/.env
set +a
# adapter-node rejects an empty ORIGIN ("Invalid ORIGIN: ''"); only pass it when it's a real URL.
# Empty means LAN-only, where SvelteKit derives the origin from the request instead.
[ -n "${ORIGIN:-}" ] || unset ORIGIN
exec node apps/web/build
