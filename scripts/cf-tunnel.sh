#!/usr/bin/env bash
# ==============================================================================
#  SparkPrint — Cloudflare Tunnel setup / repair
# ------------------------------------------------------------------------------
#  Publishes SparkPrint on a subdomain of your Cloudflare domain over HTTPS, with
#  no port-forwarding. Idempotent: safe to re-run to change the subdomain or fix a
#  half-finished setup — it recreates the tunnel cleanly each time.
#
#  Usage (as root):
#     sudo bash scripts/cf-tunnel.sh [subdomain]
#     sudo bash scripts/cf-tunnel.sh lataprint.sparkden.org
#  With no argument it prompts for the subdomain.
# ==============================================================================
set -uo pipefail

APP_DIR="${SPARKPRINT_DIR:-/opt/sparkprint}"
ENV_FILE="$APP_DIR/apps/web/.env"
TUNNEL_NAME="${SPARKPRINT_TUNNEL:-sparkprint}"
ARCH="$(uname -m)"
SUDO_USER_HOME="$(getent passwd "${SUDO_USER:-root}" 2>/dev/null | cut -d: -f6)"

if [ -t 1 ]; then B="\033[1m"; G="\033[32m"; Y="\033[33m"; R="\033[31m"; N="\033[0m"; else B=""; G=""; Y=""; R=""; N=""; fi
ok()   { echo -e "  ${G}✓${N} $*"; }
warn() { echo -e "  ${Y}!${N} $*"; }
die()  { echo -e "\n${R}✗ $*${N}" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo:  sudo bash $0 [subdomain]"

# App port from the env file (default 3000).
APP_PORT="$(grep -oE '^PORT="?[0-9]+' "$ENV_FILE" 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)"
[ -n "$APP_PORT" ] || APP_PORT=3000

# ── cloudflared present? ────────────────────────────────────────────────────────
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "  Installing cloudflared…"
  CF_ARCH="$([ "$ARCH" = "aarch64" ] && echo arm64 || echo amd64)"
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" -o /usr/local/bin/cloudflared \
    && chmod +x /usr/local/bin/cloudflared && ok "cloudflared installed." || die "cloudflared install failed."
fi

# ── Use the account login cert; log in if needed ────────────────────────────────
# cloudflared reads $HOME/.cloudflared — point HOME at wherever the cert already is.
for h in /root "$SUDO_USER_HOME" "${HOME:-}"; do
  [ -n "$h" ] && [ -f "$h/.cloudflared/cert.pem" ] && { export HOME="$h"; break; }
done
if [ ! -f "${HOME:-/root}/.cloudflared/cert.pem" ]; then
  export HOME=/root
  echo -e "\n  ${B}A browser login link will appear. Open it, pick the domain to authorize, and approve.${N}"
  cloudflared tunnel login || die "Cloudflare login didn't complete."
fi
CF_DIR="$HOME/.cloudflared"

# ── Subdomain ───────────────────────────────────────────────────────────────────
SUB="${1:-}"
if [ -z "$SUB" ]; then
  echo -e "\n  ${B}Address students will visit — use a SUBDOMAIN, e.g. print.yourschool.org${N}"
  read -rp "  Subdomain to publish on: " SUB
fi
[ -n "$SUB" ] || die "No subdomain given."
case "$SUB" in http*://*) SUB="${SUB#*://}"; SUB="${SUB%%/*}";; esac  # tolerate a pasted URL
if [ "$(printf '%s' "$SUB" | tr -cd '.' | wc -c)" -lt 2 ]; then
  warn "'$SUB' looks like a bare domain — a subdomain like print.$SUB is usually what you want."
fi

# ── Recreate the tunnel cleanly (guarantees we hold its credentials) ─────────────
echo "  Setting up tunnel '$TUNNEL_NAME' for https://$SUB …"
# Stop any running connector first so the tunnel has no active connections to delete.
systemctl stop cloudflared >/dev/null 2>&1 || true
cloudflared tunnel cleanup "$TUNNEL_NAME" >/dev/null 2>&1 || true
cloudflared tunnel delete "$TUNNEL_NAME" >/dev/null 2>&1 || true
cloudflared tunnel create "$TUNNEL_NAME" >/dev/null 2>&1 || die "Couldn't create the tunnel (check the login/domain)."

# Resolve the new tunnel id + its credentials file.
TUNNEL_ID="$(cloudflared tunnel list --name "$TUNNEL_NAME" --output json 2>/dev/null | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' | head -1)"
[ -n "$TUNNEL_ID" ] || die "Tunnel created but its id wasn't found."
CRED_SRC="$CF_DIR/${TUNNEL_ID}.json"
[ -f "$CRED_SRC" ] || CRED_SRC="$(ls -1 "$CF_DIR/${TUNNEL_ID}.json" /root/.cloudflared/"${TUNNEL_ID}".json 2>/dev/null | head -1)"
[ -n "$CRED_SRC" ] && [ -f "$CRED_SRC" ] || die "Tunnel credentials file not found ($CF_DIR/${TUNNEL_ID}.json)."

# ── Deploy config + DNS + service ───────────────────────────────────────────────
mkdir -p /etc/cloudflared
cp "$CRED_SRC" "/etc/cloudflared/${TUNNEL_ID}.json"
cat > /etc/cloudflared/config.yml <<EOF
tunnel: $TUNNEL_ID
credentials-file: /etc/cloudflared/${TUNNEL_ID}.json
ingress:
  - hostname: $SUB
    service: http://localhost:$APP_PORT
  - service: http_status:404
EOF

cloudflared tunnel route dns --overwrite-dns "$TUNNEL_NAME" "$SUB" >/dev/null 2>&1 \
  || warn "Couldn't set the DNS route automatically — add a CNAME '$SUB' → ${TUNNEL_ID}.cfargotunnel.com in Cloudflare."

# Reinstall the service so it uses the fresh config.
systemctl stop cloudflared >/dev/null 2>&1 || true
cloudflared service uninstall >/dev/null 2>&1 || true
cloudflared service install >/dev/null 2>&1 || true
systemctl enable --now cloudflared >/dev/null 2>&1 || systemctl restart cloudflared >/dev/null 2>&1 || true

# Point the app at its public origin (CSRF / absolute URLs) and restart it.
if [ -f "$ENV_FILE" ]; then
  if grep -q '^ORIGIN=' "$ENV_FILE"; then
    sed -i "s#^ORIGIN=.*#ORIGIN=\"https://$SUB\"#" "$ENV_FILE"
  else
    echo "ORIGIN=\"https://$SUB\"" >> "$ENV_FILE"
  fi
  systemctl restart sparkprint >/dev/null 2>&1 || true
fi

echo
ok "Tunnel live: ${B}https://$SUB${N}"
echo "     DNS can take a minute to propagate. Check status:  sudo systemctl status cloudflared"
