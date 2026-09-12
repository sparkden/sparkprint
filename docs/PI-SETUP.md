# SparkPrint on a Raspberry Pi 5 (central server)

SparkPrint runs as a small always-on appliance on a **Raspberry Pi 5** on the same network as your
printers. One script installs everything and runs it on boot — no Docker.

> The installer also runs on any **Debian-family** (Debian / Ubuntu, `apt`) or **Arch-family**
> (Arch / Manjaro, `pacman`) machine — aarch64 or x86_64 — if you'd rather use a mini-PC or spare
> laptop instead of a Pi. The steps below are identical.

## What you need

- **Raspberry Pi 5** (4 GB+), a good power supply, and a microSD (32 GB+) or NVMe.
- **Raspberry Pi OS (64-bit)** — use **"Trixie" (Debian 13)** or newer so the OrcaSlicer engine runs
  (older "Bookworm" has too old a system library; slicing then falls back to a non-Bambu engine).
  Flash it with Raspberry Pi Imager; in its settings you can preset Wi-Fi + SSH.
- The Pi on the **same network/VLAN as the printers** (Ethernet or Wi-Fi).
- *(Optional, for a public URL)* a free **Cloudflare account** and a **domain added to it**
  (nameservers pointed to Cloudflare). No port-forwarding is needed.

## Install

SSH into the Pi (or open a terminal on it) and run:

```bash
curl -fsSL https://raw.githubusercontent.com/sparkden/sparkprint/main/install.sh -o install.sh
sudo bash install.sh
```

The script is interactive and walks you through:

1. **Network** — connects Wi-Fi if you're not already online.
2. **Packages** — Node.js, the OrcaSlicer slicing engine (headless), fonts, build tools.
3. **Database** — a local SQLite file (`apps/web/.data/sparkprint.db`); nothing to install or
   configure.
4. **Build & migrate** — builds the app and sets up the database tables.
5. **Service** — installs a `systemd` service so SparkPrint starts automatically on every boot.
6. **Cloudflare Tunnel** *(optional)* — publishes SparkPrint at `https://print.yourschool.org`
   with no port-forwarding. You'll be shown a link to authorize your domain; then pick the
   hostname and it wires up DNS + the tunnel service for you.

Re-running `sudo bash install.sh` later updates an existing install in place.

## After install

- Open the URL the script prints (`http://<pi-ip>:3000`, or your Cloudflare hostname).
- **The first person to sign up creates the lab and becomes the owner/admin.** Everyone after that
  joins the same lab (it's a single-lab, self-hosted instance).
- **Admin → Printers → Connect Bambu** to import your printers and their access codes.
- Set each printer's **Local IP** under *LAN printing* (or **Discover on network**), then print.
  See [`LAN.md`](./LAN.md).

## Managing the service

```bash
sudo systemctl status sparkprint      # running?
sudo journalctl -u sparkprint -f      # live logs
sudo systemctl restart sparkprint     # restart
sudo systemctl status cloudflared     # tunnel status (if enabled)
```

## Cloudflare Tunnel — manual setup (if you skipped it)

```bash
sudo apt install -y cloudflared            # or the .deb from Cloudflare's releases
cloudflared tunnel login                   # authorize your domain in the browser
cloudflared tunnel create sparkprint
# note the tunnel ID + credentials file it prints, then:
sudo mkdir -p /etc/cloudflared
sudo tee /etc/cloudflared/config.yml >/dev/null <<'YAML'
tunnel: <TUNNEL_ID>
credentials-file: /etc/cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: print.yourschool.org
    service: http://localhost:3000
  - service: http_status:404
YAML
cloudflared tunnel route dns sparkprint print.yourschool.org
sudo cloudflared service install
```

Then set `ORIGIN="https://print.yourschool.org"` in `/opt/sparkprint/apps/web/.env` and
`sudo systemctl restart sparkprint`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Slicing falls back / OrcaSlicer warning during install | Your OS is too old; reflash with Raspberry Pi OS **Trixie** (64-bit). |
| Can't reach the printer / prints don't start | See [`LAN.md`](./LAN.md) — set each printer's IP + access code. |
| Service won't start | `sudo journalctl -u sparkprint -e` shows why (usually the database URL). |
| Tunnel hostname 404s | DNS can take a minute; check `sudo systemctl status cloudflared`. |
