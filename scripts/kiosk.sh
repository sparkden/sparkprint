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
		apt-get update -qq || true
		apt-get install -y -qq cage seatd chromium fonts-dejavu-core \
			|| apt-get install -y -qq cage seatd chromium-browser fonts-dejavu-core \
			|| { echo "Package install failed — is this Debian/Raspberry Pi OS?"; exit 1; }
		CHROME="$(chromium_bin)" || { echo "Chromium not found after install."; exit 1; }

		systemctl enable --now seatd >/dev/null 2>&1 || true
		usermod -aG video,render,input,seat,tty "$APP_USER" 2>/dev/null || true
		UID_N="$(id -u "$APP_USER")"

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
After=systemd-user-sessions.service seatd.service network-online.target sparkprint.service
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
PAMName=login
TTYPath=/dev/tty7
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
		echo "✓ Kiosk disabled."
		;;
	status)
		systemctl is-active sparkprint-kiosk 2>/dev/null || echo "inactive"
		;;
	*)
		echo "Usage: sudo bash kiosk.sh enable <url> | disable | status"; exit 1 ;;
esac
