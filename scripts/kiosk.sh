#!/usr/bin/env bash
# ==============================================================================
#  SparkPrint kiosk — fullscreen lab monitor on a connected display, no desktop,
#  no login. Uses `cage` (a minimal Wayland kiosk compositor) + Chromium, started
#  by systemd on boot. Targets Raspberry Pi OS / Debian.
#
#  Usage (root):
#     sudo bash kiosk.sh enable "http://localhost:3000/monitor?kiosk=TOKEN"
#     sudo bash kiosk.sh disable
#     sudo bash kiosk.sh status
# ==============================================================================
set -uo pipefail

APP_USER="${SPARKPRINT_USER:-sparkprint}"
UNIT="/etc/systemd/system/sparkprint-kiosk.service"
LAUNCH="/opt/sparkprint/scripts/kiosk-launch.sh"
CMD="${1:-status}"

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }

chromium_bin() { for b in chromium chromium-browser; do command -v "$b" >/dev/null 2>&1 && { echo "$b"; return 0; }; done; return 1; }

case "$CMD" in
	enable)
		URL="${2:?A monitor URL is required}"
		echo "→ Installing kiosk packages (cage + chromium)…"
		export DEBIAN_FRONTEND=noninteractive
		# Wait up to 5 min for any other apt/dpkg run (e.g. Pi OS auto-updates) to release the lock,
		# both by polling and by asking apt itself to wait.
		APT="apt-get -o DPkg::Lock::Timeout=300"
		for _ in $(seq 1 100); do
			fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/lib/apt/lists/lock >/dev/null 2>&1 || break
			echo "  Waiting for another apt process to finish…"; sleep 3
		done
		$APT update -qq || true
		$APT install -y -qq cage seatd chromium fonts-dejavu-core \
			|| $APT install -y -qq cage seatd chromium-browser fonts-dejavu-core \
			|| { echo "Package install failed. Another apt process may still be running — try again in a minute, or check: ps aux | grep apt"; exit 1; }
		CHROME="$(chromium_bin)" || { echo "Chromium not found after install."; exit 1; }

		systemctl enable --now seatd >/dev/null 2>&1 || true
		usermod -aG video,render,input,seat,tty "$APP_USER" 2>/dev/null || true
		UID_N="$(id -u "$APP_USER")"
		# The kiosk runs on tty1 (the screen shown at boot). Stop the console login there so it doesn't
		# hold the display with a "login:" prompt. (Restored on disable.)
		systemctl disable --now getty@tty1.service >/dev/null 2>&1 || true

		# Launch wrapper: minimal Wayland kiosk (cage) running one fullscreen Chromium tab.
		cat > "$LAUNCH" <<LAUNCHEOF
#!/usr/bin/env bash
export XDG_RUNTIME_DIR="/run/user/\$(id -u)"
mkdir -p "\$XDG_RUNTIME_DIR"; chmod 700 "\$XDG_RUNTIME_DIR" 2>/dev/null || true
export WLR_LIBINPUT_NO_DEVICES=1
exec cage -- "$CHROME" --kiosk --noerrdialogs --disable-infobars \\
  --disable-session-crashed-bubble --disable-features=Translate \\
  --check-for-update-interval=31536000 --ozone-platform=wayland \\
  --password-store=basic --overscroll-history-navigation=0 "$URL"
LAUNCHEOF
		chmod +x "$LAUNCH"

		cat > "$UNIT" <<UNITEOF
[Unit]
Description=SparkPrint kiosk display
After=systemd-user-sessions.service seatd.service network-online.target sparkprint.service getty@tty1.service
Conflicts=getty@tty1.service
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
PAMName=login
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
StandardInput=tty
StandardOutput=journal
StandardError=journal
Environment=XDG_RUNTIME_DIR=/run/user/$UID_N
ExecStartPre=/bin/mkdir -p /run/user/$UID_N
ExecStartPre=/bin/chown $APP_USER /run/user/$UID_N
ExecStart=$LAUNCH
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNITEOF
		systemctl daemon-reload
		systemctl enable --now sparkprint-kiosk >/dev/null 2>&1 || true
		sleep 2
		if systemctl is-active --quiet sparkprint-kiosk; then echo "✓ Kiosk running on the connected display."; else
			echo "! Kiosk service didn't start cleanly. It often works after a reboot (seat/GPU init)."
			echo "  Logs: journalctl -u sparkprint-kiosk -e"
		fi
		echo "  URL: $URL"
		;;
	disable)
		systemctl disable --now sparkprint-kiosk >/dev/null 2>&1 || true
		rm -f "$UNIT"; systemctl daemon-reload
		systemctl enable --now getty@tty1.service >/dev/null 2>&1 || true # restore the console login
		echo "✓ Kiosk disabled."
		;;
	status)
		systemctl is-active sparkprint-kiosk 2>/dev/null || echo "inactive"
		;;
	*)
		echo "Usage: sudo bash kiosk.sh enable <url> | disable | status"; exit 1 ;;
esac
