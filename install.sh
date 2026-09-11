#!/usr/bin/env bash
# ==============================================================================
#  SparkPrint — Raspberry Pi 5 one-shot installer
# ------------------------------------------------------------------------------
#  Turns a fresh Raspberry Pi 5 (Raspberry Pi OS 64-bit) into a self-contained
#  SparkPrint "print server" appliance:
#    • connects Wi-Fi (if not already online)
#    • installs Node, OrcaSlicer (headless), and all system deps
#    • sets up PostgreSQL (local) or uses a database URL you provide
#    • builds the app and runs it on boot via systemd
#    • (optional) publishes it on YOUR domain via a Cloudflare Tunnel — no
#      port-forwarding, no firewall changes, works behind school networks
#
#  Run on the Pi:
#     curl -fsSL https://raw.githubusercontent.com/sparkden/sparkprint/main/install.sh -o install.sh
#     sudo bash install.sh
#  (or, from a checkout:  sudo bash install.sh )
#
#  Safe to re-run — it updates an existing install in place.
# ==============================================================================
set -euo pipefail

# ── Config (override via env) ─────────────────────────────────────────────────
REPO_URL="${SPARKPRINT_REPO:-https://github.com/sparkden/sparkprint.git}"
BRANCH="${SPARKPRINT_BRANCH:-main}"
APP_DIR="${SPARKPRINT_DIR:-/opt/sparkprint}"
APP_USER="sparkprint"
APP_PORT="${SPARKPRINT_PORT:-3000}"
NODE_MAJOR="22"
ORCA_VERSION="${ORCA_VERSION:-2.4.2}"

# ── Pretty output ─────────────────────────────────────────────────────────────
if [ -t 1 ]; then B="\033[1m"; G="\033[32m"; Y="\033[33m"; R="\033[31m"; C="\033[36m"; N="\033[0m"; else B=""; G=""; Y=""; R=""; C=""; N=""; fi
step() { echo -e "\n${B}${C}==> $*${N}"; }
ok()   { echo -e "  ${G}✓${N} $*"; }
warn() { echo -e "  ${Y}!${N} $*"; }
die()  { echo -e "\n${R}✗ $*${N}" >&2; exit 1; }
ask()  { local p="$1" d="${2:-}" r; if [ -n "$d" ]; then read -rp "  $p [$d]: " r; echo "${r:-$d}"; else read -rp "  $p: " r; echo "$r"; fi; }
askyn(){ local p="$1" d="${2:-y}" r; read -rp "  $p ($([ "$d" = y ] && echo 'Y/n' || echo 'y/N')): " r; r="${r:-$d}"; [[ "$r" =~ ^[Yy] ]]; }

# ── Preflight ─────────────────────────────────────────────────────────────────
step "SparkPrint installer"
[ "$(id -u)" -eq 0 ] || die "Please run with sudo:  sudo bash install.sh"
ARCH="$(uname -m)"
[ "$ARCH" = "aarch64" ] || warn "Expected a 64-bit Pi (aarch64); found $ARCH. Continuing anyway."
. /etc/os-release 2>/dev/null || true
echo "  OS: ${PRETTY_NAME:-unknown} · arch: $ARCH"
GLIBC="$(ldd --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo 0)"
SUDO_USER_HOME="$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)"

# ── 1. Wi-Fi ──────────────────────────────────────────────────────────────────
step "1/9  Network"
if ping -c1 -W2 1.1.1.1 >/dev/null 2>&1; then
  ok "Already online."
else
  warn "No internet connection detected."
  if command -v nmcli >/dev/null 2>&1 && askyn "Configure Wi-Fi now?"; then
    nmcli -t -f SSID dev wifi list 2>/dev/null | awk 'NF' | sort -u | sed 's/^/    • /' | head -20 || true
    SSID="$(ask 'Wi-Fi network name (SSID)')"
    read -rsp "  Wi-Fi password: " WPASS; echo
    nmcli dev wifi connect "$SSID" password "$WPASS" && ok "Connected to $SSID." || die "Wi-Fi connection failed."
  else
    die "Need an internet connection to install. Plug in Ethernet or configure Wi-Fi, then re-run."
  fi
fi

# ── 2. System packages ─────────────────────────────────────────────────────────
step "2/9  System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# Build tools, headless-GL libs for OrcaSlicer, fonts, and git/curl.
apt-get install -y -qq \
  ca-certificates curl git build-essential xvfb ffmpeg \
  libgl1 libegl1 libglu1-mesa libgtk-3-0 libgomp1 libnss3 libsecret-1-0 \
  libwebkit2gtk-4.1-0 fontconfig fonts-dejavu-core >/dev/null 2>&1 \
  || apt-get install -y -qq ca-certificates curl git build-essential xvfb ffmpeg libgl1 libegl1 libglu1-mesa libgtk-3-0 libgomp1 libnss3 fontconfig fonts-dejavu-core >/dev/null
ok "Base packages installed."

# Node.js
if command -v node >/dev/null 2>&1 && [ "$(node -v | grep -oE '[0-9]+' | head -1)" -ge "$NODE_MAJOR" ] 2>/dev/null; then
  ok "Node $(node -v) already present."
else
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
  ok "Installed Node $(node -v)."
fi

# ── 3. App user + code ──────────────────────────────────────────────────────────
step "3/9  Application files"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH" -q && git -C "$APP_DIR" reset --hard "origin/$BRANCH" -q
  ok "Updated existing checkout in $APP_DIR."
elif [ -d "$(pwd)/.git" ] && [ "$(pwd)" != "$APP_DIR" ]; then
  # Running from a local checkout: copy it in.
  mkdir -p "$APP_DIR"; cp -a "$(pwd)/." "$APP_DIR/"; ok "Copied local checkout to $APP_DIR."
elif [ ! -d "$APP_DIR/apps" ]; then
  git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$APP_DIR" -q && ok "Cloned SparkPrint to $APP_DIR."
else
  ok "Using existing files in $APP_DIR."
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ── 4. Database ──────────────────────────────────────────────────────────────────
step "4/9  Database"
ENV_FILE="$APP_DIR/apps/web/.env"
EXISTING_DB=""; [ -f "$ENV_FILE" ] && EXISTING_DB="$(grep -oP '(?<=^DATABASE_URL=").*(?=")' "$ENV_FILE" 2>/dev/null || true)"
if [ -n "$EXISTING_DB" ] && askyn "Keep the existing database URL?"; then
  DATABASE_URL="$EXISTING_DB"; ok "Keeping existing database."
elif askyn "Install a local PostgreSQL on this Pi? (recommended for a standalone box)"; then
  apt-get install -y -qq postgresql >/dev/null
  systemctl enable --now postgresql >/dev/null 2>&1 || true
  DBPASS="$(openssl rand -hex 16)"
  sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='sparkprint'" | grep -q 1 \
    || sudo -u postgres psql -q -c "CREATE USER sparkprint WITH PASSWORD '$DBPASS';"
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='sparkprint'" | grep -q 1 \
    || sudo -u postgres psql -q -c "CREATE DATABASE sparkprint OWNER sparkprint;"
  # If the role already existed, reset the password so our URL is valid.
  sudo -u postgres psql -q -c "ALTER USER sparkprint WITH PASSWORD '$DBPASS';"
  DATABASE_URL="postgresql://sparkprint:${DBPASS}@localhost:5432/sparkprint"
  ok "Local PostgreSQL ready."
else
  DATABASE_URL="$(ask 'Paste your PostgreSQL connection URL')"
  [ -n "$DATABASE_URL" ] || die "A database URL is required."
fi

# ── 5. OrcaSlicer (headless slicing) ─────────────────────────────────────────────
step "5/9  OrcaSlicer (slicing engine)"
ORCA_DIR="$APP_DIR/slicers/orca"
ORCA_APPRUN="$ORCA_DIR/squashfs-root/AppRun"
if [ -x "$ORCA_APPRUN" ]; then
  ok "OrcaSlicer already installed."
else
  # The Ubuntu-24.04 AppImage needs glibc >= 2.39. Pi OS Trixie (2.41) is fine; Bookworm (2.36) is not.
  if [ "$(printf '%s\n2.39\n' "$GLIBC" | sort -V | head -1)" != "2.39" ]; then
    warn "This OS has glibc $GLIBC; OrcaSlicer $ORCA_VERSION needs >= 2.39."
    warn "Slicing will fall back to the bundled Slic3r (non-Bambu G-code)."
    warn "For full OrcaSlicer support, use Raspberry Pi OS 'Trixie' (64-bit) or newer."
  else
    mkdir -p "$ORCA_DIR"
    URL="https://github.com/SoftFever/OrcaSlicer/releases/download/v${ORCA_VERSION}/OrcaSlicer_Linux_AppImage_Ubuntu2404_aarch64_V${ORCA_VERSION}.AppImage"
    echo "  Downloading OrcaSlicer $ORCA_VERSION (aarch64)…"
    if curl -fsSL "$URL" -o "$ORCA_DIR/orca.AppImage"; then
      chmod +x "$ORCA_DIR/orca.AppImage"
      ( cd "$ORCA_DIR" && ./orca.AppImage --appimage-extract >/dev/null 2>&1 ) && rm -f "$ORCA_DIR/orca.AppImage"
      [ -x "$ORCA_APPRUN" ] && ok "OrcaSlicer installed." || warn "OrcaSlicer extract failed; will use the Slic3r fallback."
    else
      warn "Couldn't download OrcaSlicer; will use the Slic3r fallback."
    fi
  fi
fi
chown -R "$APP_USER:$APP_USER" "$ORCA_DIR" 2>/dev/null || true

# ── 6. Environment file ───────────────────────────────────────────────────────
step "6/9  Configuration"
APP_SECRET="$( { [ -f "$ENV_FILE" ] && grep -oP '(?<=^APP_SECRET=").*(?=")' "$ENV_FILE"; } 2>/dev/null || true )"
[ -n "$APP_SECRET" ] || APP_SECRET="$(openssl rand -hex 32)"
mkdir -p "$APP_DIR/apps/web/.data/storage"
cat > "$ENV_FILE" <<EOF
DATABASE_URL="$DATABASE_URL"
APP_SECRET="$APP_SECRET"
STORAGE_DIR="./.data/storage"
BAMBU_MODE="cloud"
NODE_ENV="production"
PORT="$APP_PORT"
HOST="0.0.0.0"
# Set automatically if you enable the Cloudflare Tunnel below.
ORIGIN=""
$( [ -x "$ORCA_APPRUN" ] && echo "ORCA_APPRUN=\"$ORCA_APPRUN\"" )
EOF
chown "$APP_USER:$APP_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"
ok "Wrote $ENV_FILE"

# ── 7. Build + migrate ────────────────────────────────────────────────────────
step "7/9  Build & database migration (a few minutes)…"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm ci --no-audit --no-fund" || die "npm install failed."
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm run build -w @sparkprint/web" || die "Build failed."
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR/apps/web' && set -a && . .env && set +a && node scripts/migrate.js" && ok "Database migrated." || warn "Migration step reported an issue — check the DB URL."
chmod +x "$APP_DIR/scripts/run-prod.sh"

# ── 8. systemd service (runs on boot) ────────────────────────────────────────────
step "8/9  System service"
cat > /etc/systemd/system/sparkprint.service <<EOF
[Unit]
Description=SparkPrint server
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/env bash $APP_DIR/scripts/run-prod.sh
Restart=always
RestartSec=5
# Writable storage
ReadWritePaths=$APP_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable sparkprint >/dev/null 2>&1
systemctl restart sparkprint
sleep 3
systemctl is-active --quiet sparkprint && ok "SparkPrint service is running on port $APP_PORT." || warn "Service didn't start — check: journalctl -u sparkprint -e"

# ── 9. Cloudflare Tunnel (optional custom domain) ────────────────────────────────
step "9/9  Public access via Cloudflare Tunnel (optional)"
cat <<'EOF'
  A Cloudflare Tunnel publishes SparkPrint on your own domain (e.g. print.yourschool.org)
  with HTTPS, and WITHOUT any port-forwarding or firewall changes.

  One-time prerequisites (free):
    1. A Cloudflare account:            https://dash.cloudflare.com/sign-up
    2. A domain added to that account (its nameservers pointed to Cloudflare).
       No domain yet? Register one (e.g. Cloudflare Registrar, Namecheap) and add it.
  Skip this to just use the Pi on your local network (http://<pi-ip>:PORT).
EOF
if askyn "Set up a Cloudflare Tunnel now?"; then
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "  Installing cloudflared…"
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb" -o /tmp/cf.deb \
      && apt-get install -y -qq /tmp/cf.deb >/dev/null && rm -f /tmp/cf.deb && ok "cloudflared installed." || warn "cloudflared install failed."
  fi
  if command -v cloudflared >/dev/null 2>&1; then
    echo -e "\n  ${B}A browser login link will appear. Open it, pick your domain, and authorize.${N}"
    cloudflared tunnel login || warn "Login not completed."
    HOSTNAME="$(ask 'Full hostname to use (e.g. print.yourschool.org)')"
    TUNNEL_NAME="sparkprint"
    cloudflared tunnel list 2>/dev/null | grep -q " $TUNNEL_NAME " || cloudflared tunnel create "$TUNNEL_NAME"
    TUNNEL_ID="$(cloudflared tunnel list 2>/dev/null | awk -v n="$TUNNEL_NAME" '$2==n{print $1}' | head -1)"
    CRED_FILE="$(ls -1 "$SUDO_USER_HOME/.cloudflared/${TUNNEL_ID}.json" /root/.cloudflared/${TUNNEL_ID}.json 2>/dev/null | head -1)"
    if [ -n "$TUNNEL_ID" ] && [ -n "$CRED_FILE" ]; then
      mkdir -p /etc/cloudflared
      cp "$CRED_FILE" "/etc/cloudflared/${TUNNEL_ID}.json"
      cat > /etc/cloudflared/config.yml <<EOF
tunnel: $TUNNEL_ID
credentials-file: /etc/cloudflared/${TUNNEL_ID}.json
ingress:
  - hostname: $HOSTNAME
    service: http://localhost:$APP_PORT
  - service: http_status:404
EOF
      cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME" || warn "DNS route may already exist."
      cloudflared service install >/dev/null 2>&1 || true
      systemctl enable --now cloudflared >/dev/null 2>&1 || true
      # Point the app at its public origin (CSRF / absolute URLs) and restart.
      sed -i "s#^ORIGIN=.*#ORIGIN=\"https://$HOSTNAME\"#" "$ENV_FILE"
      systemctl restart sparkprint
      ok "Tunnel live: https://$HOSTNAME  (DNS may take a minute to propagate)"
    else
      warn "Couldn't finish tunnel setup automatically. See docs/PI-SETUP.md for manual steps."
    fi
  fi
else
  ok "Skipped — use SparkPrint at http://$(hostname -I | awk '{print $1}'):$APP_PORT on your network."
fi

# ── Done ──────────────────────────────────────────────────────────────────────
IP="$(hostname -I | awk '{print $1}')"
step "Done 🎉"
echo -e "  Local:   ${B}http://$IP:$APP_PORT${N}"
grep -q 'ORIGIN="https' "$ENV_FILE" 2>/dev/null && echo -e "  Public:  ${B}$(grep -oP '(?<=^ORIGIN=").*(?=")' "$ENV_FILE")${N}"
cat <<EOF

  Next steps:
    1. Open SparkPrint in a browser and finish the first-run admin setup.
    2. Admin → Printers → connect your Bambu account (imports printers + access codes).
    3. For each printer, set its Local IP under "LAN printing" (or click "Discover on network").
       See the LAN guide:  $APP_DIR/docs/LAN.md

  Manage the service:
    sudo systemctl status sparkprint      # is it running?
    sudo journalctl -u sparkprint -f      # live logs
    sudo systemctl restart sparkprint     # restart
    sudo bash $APP_DIR/install.sh         # update / re-run

EOF
