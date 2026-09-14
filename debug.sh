#!/usr/bin/env bash
# ==============================================================================
#  SparkPrint — debug collector
# ------------------------------------------------------------------------------
#  Gathers everything needed to diagnose a broken install (OS/glibc/arch, the
#  OrcaSlicer headless error, npm/build errors, systemd logs, config with secrets
#  redacted), writes it to one file, and uploads that file to a free paste site.
#  It prints a URL at the end — share that URL and support can read the report.
#
#  Run on the Pi (root recommended, so it can read service logs + test the slicer):
#     curl -fsSL https://raw.githubusercontent.com/sparkden/sparkprint/main/debug.sh -o debug.sh
#     sudo bash debug.sh
#
#  Nothing is sent anywhere except the final upload, which you trigger by running it.
#  Re-run a full reinstall capture with:  sudo DEBUG_REINSTALL=1 bash debug.sh
# ==============================================================================
set -uo pipefail  # NOT -e: we want to keep going and record failures.

APP_DIR="${SPARKPRINT_DIR:-/opt/sparkprint}"
APP_USER="sparkprint"
ORCA_APPRUN="$APP_DIR/slicers/orca/squashfs-root/AppRun"
LOG="$(mktemp /tmp/sparkprint-debug.XXXXXX.txt)"

if [ -t 1 ]; then B="\033[1m"; G="\033[32m"; Y="\033[33m"; C="\033[36m"; N="\033[0m"; else B=""; G=""; Y=""; C=""; N=""; fi
say()  { echo -e "$*"; }
note() { echo -e "  ${C}·${N} $*"; }

section() { printf '\n\n========== %s ==========\n' "$*" >>"$LOG"; note "$*"; }
# run "<shell command>" — records the command, its output, and its exit code.
run() {
  printf '\n$ %s\n' "$1" >>"$LOG"
  local out rc
  out="$(timeout 150 bash -c "$1" 2>&1)"; rc=$?
  printf '%s\n' "$out" >>"$LOG"
  printf '[exit %s]\n' "$rc" >>"$LOG"
}
have() { command -v "$1" >/dev/null 2>&1; }

say "${B}${C}==> SparkPrint debug collector${N}"
[ "$(id -u)" -eq 0 ] || say "  ${Y}!${N} Not running as root — service logs and the slicer test may be skipped. Prefer: sudo bash debug.sh"
note "Writing report to $LOG"

# ── Identity / hardware ─────────────────────────────────────────────────────────
{
  echo "SparkPrint debug report"
  echo "generated: $(date -u '+%Y-%m-%d %H:%M:%SZ')"
  echo "app dir:   $APP_DIR"
} >>"$LOG"

section "System"
run "uname -a"
run "echo arch=\$(uname -m) bits=\$(getconf LONG_BIT)"
run "cat /etc/os-release 2>/dev/null"
run "cat /proc/device-tree/model 2>/dev/null; echo"          # Raspberry Pi model, if present
run "ldd --version 2>&1 | head -1"                            # glibc version
run "nproc; free -h 2>/dev/null; df -h / '$APP_DIR' 2>/dev/null"

section "Toolchain"
for t in node npm python3 make g++ cc git curl xvfb-run cloudflared nc; do
  run "command -v $t >/dev/null 2>&1 && { echo -n '$t: '; $t --version 2>&1 | head -1; } || echo '$t: MISSING'"
done

section "Headless GL (needed for OrcaSlicer under Xvfb)"
run "ls -1 /usr/lib/*/dri/ 2>/dev/null | grep -iE 'swrast|llvmpipe|kms' || echo 'no software-GL (swrast/llvmpipe) DRI driver found'"
run "ldconfig -p 2>/dev/null | grep -iE 'libgl\\.|libegl|libgtk-3|libwebkit2gtk|libnss3|libxkbcommon' | head -30"

# ── OrcaSlicer ─────────────────────────────────────────────────────────────────
section "OrcaSlicer install"
run "ls -l '$ORCA_APPRUN' 2>&1"
run "file '$ORCA_APPRUN' 2>&1"
if [ -x "$ORCA_APPRUN" ]; then
  # ldd against the AppRun and the main ELF, to surface any 'not found' libs / GLIBC symbols.
  run "ldd '$ORCA_APPRUN' 2>&1 | grep -iE 'not found|GLIBC' | head -40 || echo 'ldd: no missing libs reported'"
  MAIN_BIN="$(find "$APP_DIR/slicers/orca/squashfs-root" -maxdepth 3 -type f \( -iname 'orca-slicer' -o -iname 'orcaslicer' \) 2>/dev/null | head -1)"
  [ -n "${MAIN_BIN:-}" ] && run "ldd '$MAIN_BIN' 2>&1 | grep -iE 'not found|GLIBC' | head -40 || echo 'main binary: no missing libs'"
  section "OrcaSlicer headless launch test (xvfb-run … AppRun --help)"
  if have xvfb-run; then
    if [ "$(id -u)" -eq 0 ] && id "$APP_USER" >/dev/null 2>&1; then
      run "sudo -u '$APP_USER' timeout 90 xvfb-run -a '$ORCA_APPRUN' --help 2>&1 | head -40"
      # Force software GL and retry — this is the usual fix if the plain run fails on a headless box.
      run "sudo -u '$APP_USER' env LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe timeout 90 xvfb-run -a '$ORCA_APPRUN' --help 2>&1 | head -40"
    else
      run "timeout 90 xvfb-run -a '$ORCA_APPRUN' --help 2>&1 | head -40"
      run "env LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe timeout 90 xvfb-run -a '$ORCA_APPRUN' --help 2>&1 | head -40"
    fi
  else
    echo "xvfb-run not installed — cannot test." >>"$LOG"
  fi
else
  echo "AppRun not present/executable — OrcaSlicer isn't installed." >>"$LOG"
fi

# ── npm / build errors ─────────────────────────────────────────────────────────
section "npm debug logs (most recent)"
NPM_DIRS=("$APP_DIR/.npm/_logs" "/root/.npm/_logs" "${HOME:-/root}/.npm/_logs")
for d in /home/*/.npm/_logs; do NPM_DIRS+=("$d"); done
for d in "${NPM_DIRS[@]}"; do
  [ -d "$d" ] || continue
  # shellcheck disable=SC2012
  for f in $(ls -1t "$d"/*.log 2>/dev/null | head -2); do
    printf '\n--- %s (tail) ---\n' "$f" >>"$LOG"
    tail -n 200 "$f" >>"$LOG" 2>&1
  done
done

# Reproduce the failing install if the app never built (or on request) — captures the real error.
if [ ! -d "$APP_DIR/apps/web/build" ] || [ "${DEBUG_REINSTALL:-0}" = 1 ]; then
  section "Reproducing npm install + build (a few minutes — capturing the real error)"
  note "Building… this can take several minutes on a Pi."
  if [ "$(id -u)" -eq 0 ] && id "$APP_USER" >/dev/null 2>&1; then RUN_AS=(sudo -u "$APP_USER" bash -lc); else RUN_AS=(bash -lc); fi
  printf '\n$ npm ci (in %s)\n' "$APP_DIR" >>"$LOG"
  "${RUN_AS[@]}" "cd '$APP_DIR' && npm ci --no-audit --no-fund 2>&1 | tail -n 300" >>"$LOG" 2>&1
  printf '[exit %s]\n' "$?" >>"$LOG"
  printf '\n$ npm run build -w @sparkprint/web\n' >>"$LOG"
  "${RUN_AS[@]}" "cd '$APP_DIR' && npm run build -w @sparkprint/web 2>&1 | tail -n 150" >>"$LOG" 2>&1
  printf '[exit %s]\n' "$?" >>"$LOG"
else
  note "App is already built — skipping reinstall (run with DEBUG_REINSTALL=1 to force it)."
fi

# ── Service + config ────────────────────────────────────────────────────────────
section "systemd service"
run "systemctl status sparkprint --no-pager 2>&1 | head -30"
run "journalctl -u sparkprint -n 200 --no-pager 2>&1"
run "systemctl status cloudflared --no-pager 2>&1 | head -15"

section "Config (.env — secrets redacted)"
if [ -f "$APP_DIR/apps/web/.env" ]; then
  run "sed -E 's/((SECRET|PASSWORD|PASSWD|TOKEN|APIKEY|API_KEY|KEY|ACCESS[_-]?CODE)[A-Z_]*=)\"?[^\"]*\"?/\\1<redacted>/Ig' '$APP_DIR/apps/web/.env'"
else
  echo "no .env at $APP_DIR/apps/web/.env" >>"$LOG"
fi
run "git -C '$APP_DIR' log --oneline -1 2>&1; git -C '$APP_DIR' status -sb 2>&1 | head -5"

# ── Upload ──────────────────────────────────────────────────────────────────────
SIZE="$(wc -c <"$LOG" 2>/dev/null || echo '?')"
say "\n${B}==> Report ready${N} (${SIZE} bytes). Uploading…"

upload() {
  local f="$1" url
  # 0x0.st — returns the raw URL.
  url="$(curl -fsS -F "file=@$f" https://0x0.st 2>/dev/null | tr -d '\r')"
  case "$url" in https://*) echo "$url"; return 0;; esac
  # paste.rs — returns the raw URL.
  url="$(curl -fsS --data-binary "@$f" https://paste.rs/ 2>/dev/null | tr -d '\r')"
  case "$url" in https://*) echo "$url"; return 0;; esac
  # termbin — netcat paste.
  if command -v nc >/dev/null 2>&1; then
    url="$(nc -w 15 termbin.com 9999 <"$f" 2>/dev/null | tr -d '\0\r\n')"
    case "$url" in https://*|http://*) echo "$url"; return 0;; esac
  fi
  # bashupload — parse the URL out of its response.
  url="$(curl -fsS --upload-file "$f" "https://bashupload.com/sparkprint-debug.txt" 2>/dev/null | grep -oE 'https://[^ ]+' | head -1)"
  case "$url" in https://*) echo "${url}?download=1"; return 0;; esac
  return 1
}

URL="$(upload "$LOG")" || URL=""
echo
if [ -n "$URL" ]; then
  say "${G}${B}  ✓ Uploaded. Share this link:${N}"
  say "${B}    $URL${N}"
  say "  (Raw text — open it or paste the link back to support.)"
else
  say "${Y}  ! Upload failed (no internet, or the paste sites are down).${N}"
  say "  The full report is saved locally — send this file instead:"
  say "${B}    $LOG${N}"
  say "  Or upload it yourself, e.g.:  curl -F 'file=@$LOG' https://0x0.st"
fi
echo
