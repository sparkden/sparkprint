#!/usr/bin/env bash
# ==============================================================================
#  SparkPrint — one-shot on-site installer
# ------------------------------------------------------------------------------
#  Turns a fresh Linux box into a self-contained SparkPrint "print server" appliance.
#  Works on Debian family (Debian / Ubuntu / Raspberry Pi OS, apt) and Arch family
#  (Arch / Manjaro, pacman); aarch64 (Pi 5) or x86_64. Steps:
#    • connects Wi-Fi (if not already online)
#    • installs Node, OrcaSlicer (headless), and all system deps
#    • stores data in a local SQLite file (nothing to configure)
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
# "latest" = newest release that matches this machine's arch + glibc. Pin a version to override.
ORCA_VERSION="${ORCA_VERSION:-latest}"

# ── Pretty output ─────────────────────────────────────────────────────────────
if [ -t 1 ]; then B="\033[1m"; G="\033[32m"; Y="\033[33m"; R="\033[31m"; C="\033[36m"; N="\033[0m"; else B=""; G=""; Y=""; R=""; C=""; N=""; fi
step() { echo -e "\n${B}${C}==> $*${N}"; }
ok()   { echo -e "  ${G}✓${N} $*"; }
warn() { echo -e "  ${Y}!${N} $*"; }
die()  { echo -e "\n${R}✗ $*${N}" >&2; exit 1; }
ask()  { local p="$1" d="${2:-}" r; if [ -n "$d" ]; then read -rp "  $p [$d]: " r; echo "${r:-$d}"; else read -rp "  $p: " r; echo "$r"; fi; }
askyn(){ local p="$1" d="${2:-y}" r; read -rp "  $p ($([ "$d" = y ] && echo 'Y/n' || echo 'y/N')): " r; r="${r:-$d}"; [[ "$r" =~ ^[Yy] ]]; }

# Run a long/quiet command with a live heartbeat so it never looks hung. Output is captured; on
# failure the tail is shown. Args: "<message>" cmd [args…]  (cmd may be a shell function).
run_bg() {
  local msg="$1"; shift
  local log; log="$(mktemp)"
  ( "$@" ) >"$log" 2>&1 &
  local pid=$! start=$SECONDS rc=0
  local spin='|/-\' i=0
  if [ -t 1 ]; then
    while kill -0 "$pid" 2>/dev/null; do
      i=$(( (i + 1) % 4 ))
      printf "\r  ${C}%s${N} %s… (%ds)" "${spin:$i:1}" "$msg" "$((SECONDS - start))"
      sleep 0.5
    done
    printf "\r\033[K"
  else
    printf "  %s" "$msg"
    while kill -0 "$pid" 2>/dev/null; do printf '.'; sleep 5; done
    printf "\n"
  fi
  wait "$pid" || rc=$?
  if [ "$rc" -eq 0 ]; then ok "$msg ($((SECONDS - start))s)"; else warn "$msg — failed (exit $rc):"; tail -n 15 "$log" | sed 's/^/      /'; fi
  rm -f "$log"
  return "$rc"
}

# ── Preflight ─────────────────────────────────────────────────────────────────
step "SparkPrint installer"
[ "$(id -u)" -eq 0 ] || die "Please run with sudo:  sudo bash install.sh"
ARCH="$(uname -m)"
case "$ARCH" in aarch64|x86_64) ;; *) warn "Untested architecture ($ARCH); expected aarch64 or x86_64. Continuing anyway." ;; esac
. /etc/os-release 2>/dev/null || true
echo "  OS: ${PRETTY_NAME:-unknown} · arch: $ARCH"
GLIBC="$(ldd --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo 0)"
SUDO_USER_HOME="$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)"

# Package manager (Debian/Ubuntu/Raspberry Pi OS → apt; Arch/Manjaro → pacman).
if command -v apt-get >/dev/null 2>&1; then PM=apt
elif command -v pacman >/dev/null 2>&1; then PM=pacman
else die "Unsupported distro — need apt (Debian family) or pacman (Arch family)."; fi
echo "  Package manager: $PM"

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
step "2/9  System packages (this is the slow part — a few minutes on a Pi)"
# Build tools, headless-GL libs for OrcaSlicer, fonts, curl/git, python (native sqlite build).
# libgl1-mesa-dri / mesa = software (llvmpipe) GL so OrcaSlicer renders under Xvfb on a GPU-less Pi.
# python3-setuptools is REQUIRED: Python 3.12+ dropped distutils, which node-gyp needs to compile
# better-sqlite3 — setuptools ships the distutils shim. Without it npm install fails on the Pi.
apt_packages() {
  apt-get install -y -qq \
    ca-certificates curl git build-essential python3 python3-setuptools xvfb ffmpeg \
    libgl1 libegl1 libglu1-mesa libgl1-mesa-dri libgtk-3-0 libgomp1 libnss3 libsecret-1-0 \
    libwebkit2gtk-4.1-0 libxkbcommon0 libdbus-1-3 libxrandr2 libxfixes3 libxcursor1 libxi6 \
    libxcomposite1 libxdamage1 libxtst6 fontconfig fonts-dejavu-core \
    || apt-get install -y -qq ca-certificates curl git build-essential python3 python3-setuptools xvfb ffmpeg libgl1 libegl1 libglu1-mesa libgl1-mesa-dri libgtk-3-0 libgomp1 libnss3 libxkbcommon0 libdbus-1-3 fontconfig fonts-dejavu-core
}
pacman_packages() {
  pacman -Sy --needed --noconfirm \
    ca-certificates curl git base-devel python python-setuptools xorg-server-xvfb ffmpeg \
    mesa libglvnd glu gtk3 gcc-libs nss libsecret webkit2gtk-4.1 libxkbcommon dbus \
    libxrandr libxcursor libxi libxcomposite libxdamage libxtst fontconfig ttf-dejavu \
    || pacman -Sy --needed --noconfirm ca-certificates curl git base-devel python python-setuptools xorg-server-xvfb ffmpeg mesa libglvnd glu gtk3 gcc-libs nss libsecret libxkbcommon dbus fontconfig ttf-dejavu
}
if [ "$PM" = apt ]; then
  export DEBIAN_FRONTEND=noninteractive
  run_bg "Updating package lists" apt-get update -qq || warn "apt-get update had issues — continuing."
  run_bg "Installing system libraries (Xvfb, GL, GTK, build tools)" apt_packages || die "System package install failed — see the log above."
else
  run_bg "Installing system libraries (Xvfb, GL, GTK, build tools)" pacman_packages || die "System package install failed — see the log above."
fi

# Node.js
install_node_apt() { curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - && apt-get install -y -qq nodejs; }
if command -v node >/dev/null 2>&1 && [ "$(node -v | grep -oE '[0-9]+' | head -1)" -ge "$NODE_MAJOR" ] 2>/dev/null; then
  ok "Node $(node -v) already present."
elif [ "$PM" = apt ]; then
  run_bg "Installing Node.js $NODE_MAJOR" install_node_apt || die "Node install failed."
  ok "Node $(node -v) ready."
else
  run_bg "Installing Node.js" pacman -Sy --needed --noconfirm nodejs npm || die "Node install failed."
  ok "Node $(node -v) ready."
fi

# ── 3. App user + code ──────────────────────────────────────────────────────────
step "3/9  Application files"
NOLOGIN="$(command -v nologin || echo /usr/sbin/nologin)"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APP_DIR" --shell "$NOLOGIN" "$APP_USER"
# We run git as root while the checkout is owned by the app user → mark it safe so git doesn't
# refuse with "detected dubious ownership" (breaks the update-in-place path on re-run).
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
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
# Local SQLite file — nothing to install or configure.
ENV_FILE="$APP_DIR/apps/web/.env"
DATABASE_URL="./.data/sparkprint.db"
ok "Using a local SQLite database ($APP_DIR/apps/web/.data/sparkprint.db)."

# ── 5. OrcaSlicer (headless slicing) ─────────────────────────────────────────────
step "5/9  OrcaSlicer (slicing engine → real Bambu G-code + sliced previews)"
ORCA_DIR="$APP_DIR/slicers/orca"
ORCA_APPRUN="$ORCA_DIR/squashfs-root/AppRun"
GLIBC_OK=0
[ "$(printf '%s\n2.39\n' "$GLIBC" | sort -V | head -1)" = "2.39" ] && GLIBC_OK=1

# Find the newest OrcaSlicer Linux AppImage that matches this machine's arch + glibc.
# Uses the GitHub releases API (no hardcoded filenames, so it survives version bumps). Prints
# a download URL on success; nothing on failure. Honours an explicit ORCA_VERSION pin.
resolve_orca_url() {
  local api="https://api.github.com/repos/OrcaSlicer/OrcaSlicer/releases?per_page=40"
  local all; all="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$api" 2>/dev/null | grep -oE 'https://[^"]+\.AppImage' || true)"
  [ -n "$all" ] || return 1
  # Drop nightly / experimental builds — only tagged stable releases.
  all="$(printf '%s\n' "$all" | grep -Eiv 'nightly|_belt|alpha|beta|_rc' || true)"
  # Keep only Linux AppImages for this arch (x86_64 builds simply lack an aarch64/arm64 token).
  if [ "$ARCH" = aarch64 ]; then all="$(printf '%s\n' "$all" | grep -Ei 'aarch64|arm64' || true)"
  else all="$(printf '%s\n' "$all" | grep -Eiv 'aarch64|arm64' || true)"; fi
  [ -n "$all" ] || return 1
  # If an explicit version was pinned, keep only that tag's assets (fall back to all if none match).
  if [ -n "${ORCA_VERSION:-}" ] && [ "$ORCA_VERSION" != latest ]; then
    local pinned; pinned="$(printf '%s\n' "$all" | grep -E "/v?${ORCA_VERSION}/" || true)"
    [ -n "$pinned" ] && all="$pinned"
  fi
  # On older glibc (< 2.39) prefer an Ubuntu 22.04 build; only use a 24.04 build if nothing else.
  if [ "$GLIBC_OK" -ne 1 ]; then
    local u22; u22="$(printf '%s\n' "$all" | grep -Ei 'ubuntu.?22' || true)"
    if [ -n "$u22" ]; then all="$u22"; else return 2; fi   # 2 = only-incompatible-builds-exist
  fi
  printf '%s\n' "$all" | head -1
}

if [ -x "$ORCA_APPRUN" ]; then
  ok "OrcaSlicer already installed."
else
  mkdir -p "$ORCA_DIR"
  echo "  Finding a compatible OrcaSlicer build (arch $ARCH, glibc $GLIBC)…"
  set +e; URL="$(resolve_orca_url)"; RESOLVE_RC=$?; set -e
  if [ -z "$URL" ]; then
    if [ "$RESOLVE_RC" = 2 ]; then
      warn "This OS has glibc $GLIBC, but OrcaSlicer only ships glibc≥2.39 builds for $ARCH."
      warn "Use Raspberry Pi OS 'Trixie' (64-bit) or newer for real Bambu G-code + sliced previews."
    else
      warn "Couldn't reach the OrcaSlicer release list (offline or rate-limited)."
    fi
    warn "Slicing will fall back to the bundled Slic3r (no sliced preview, non-Bambu G-code)."
  else
    echo "  Downloading $(basename "$URL")…"
    if curl -fSL "$URL" -o "$ORCA_DIR/orca.AppImage"; then
      chmod +x "$ORCA_DIR/orca.AppImage"
      # Extract (AppImages can't FUSE-mount headless) → squashfs-root/AppRun is what the app calls.
      ( cd "$ORCA_DIR" && ./orca.AppImage --appimage-extract >/dev/null 2>&1 ) && rm -f "$ORCA_DIR/orca.AppImage"
      [ -x "$ORCA_APPRUN" ] && ok "OrcaSlicer installed." || warn "OrcaSlicer extract failed; using the Slic3r fallback."
    else
      warn "Download failed; using the Slic3r fallback."
    fi
  fi
fi

# Smoke test: can the AppImage actually start headless (all shared libs resolve under Xvfb)?
# We treat "started without a missing-library error and didn't hang" as working — OrcaSlicer's
# --help may exit non-zero on some builds, so a dynamic-linker failure is the real signal.
ORCA_WORKS=0
if [ -x "$ORCA_APPRUN" ]; then
  SMOKE="$(mktemp)"
  if command -v xvfb-run >/dev/null 2>&1; then
    timeout 90 xvfb-run -a "$ORCA_APPRUN" --help >"$SMOKE" 2>&1; SMOKE_RC=$?
  else SMOKE_RC=1; fi
  if [ "$SMOKE_RC" != 124 ] && ! grep -qi 'error while loading shared libraries\|cannot open shared object' "$SMOKE"; then
    ORCA_WORKS=1; ok "OrcaSlicer runs headless — sliced previews are enabled."
  else
    warn "OrcaSlicer is installed but didn't start headless (missing library, GL, or timed out)."
    [ -s "$SMOKE" ] && warn "  $(grep -i 'shared librar\|shared object' "$SMOKE" | head -1)"
    warn "The app will fall back to Slic3r (no sliced preview). Logs: journalctl -u sparkprint -e"
  fi
  rm -f "$SMOKE"
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
After=network-online.target
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
    CF_ARCH="$([ "$ARCH" = "aarch64" ] && echo arm64 || echo amd64)"
    # Portable static binary — works on Debian and Arch alike.
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" -o /usr/local/bin/cloudflared \
      && chmod +x /usr/local/bin/cloudflared && ok "cloudflared installed." || warn "cloudflared install failed."
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
if [ "$ORCA_WORKS" = 1 ]; then echo -e "  Slicer:  ${G}OrcaSlicer (real Bambu G-code + sliced previews)${N}"
else echo -e "  Slicer:  ${Y}Slic3r fallback — no sliced preview (install OrcaSlicer for previews)${N}"; fi
cat <<EOF

  Next steps (everything is on your local network — no Bambu cloud account needed):
    1. Open SparkPrint in a browser and finish the first-run admin setup.
    2. Admin → Printers → Add printer. Set each printer's Local IP + Access code
       (Bambu screen → Settings → WLAN), or click "Discover on network".
    3. Put each printer in LAN-only mode on its own screen, then load filament so
       its colors show up for students.  Full guide:  $APP_DIR/docs/LAN.md

  Manage the service:
    sudo systemctl status sparkprint      # is it running?
    sudo journalctl -u sparkprint -f      # live logs
    sudo systemctl restart sparkprint     # restart
    sudo bash $APP_DIR/install.sh         # update / re-run

EOF
