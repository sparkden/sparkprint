# SparkPrint

Cloud 3D-printing platform for schools running Bambu Lab printers. Students import and
design models and pick a color in the browser; prints route to the next available printer
that has the right filament loaded. Admins connect one Bambu account, map AMS colors,
invite students, set per-student quotas, and optionally gate every print behind approval —
so a whole lab runs without sharing a single Bambu login.

Built with **SvelteKit 2 + Svelte 5**, **Tailwind v4** (Sparkden design system),
**SQLite + Drizzle**, with a Three.js design studio, in-process slicing (OrcaSlicer), and
LAN printing to Bambu Lab printers. Fully self-hosted — no cloud, one school per install.

## Monorepo layout

```
apps/
  web/         SvelteKit app — UI, API, auth, DB, the whole product
  electron/    Desktop wrapper (loads the web app natively)
services/
  slicer/      Headless slicing worker (BambuStudio/OrcaSlicer CLI) — scaffold
  bridge/      Bambu cloud/LAN MQTT telemetry + print dispatch — scaffold
```

## Quick start

```bash
npm install                 # installs web + services deps
npm run db:migrate          # apply schema to $DATABASE_URL
npm run dev                 # web app on http://localhost:5173
# or: ./start.sh            # dev server + public Cloudflare tunnel URL
```

Config lives in `apps/web/.env` (`DATABASE_URL`, `STORAGE_DIR`, `APP_SECRET`).

1. **Sign up** → the first user creates the lab and is the owner.
2. **Add printers** (Printers page) → **Discover on network** (SSDP) or add by hand, then set
   each printer's local IP + LAN access code.
3. **Map colors** on each printer's AMS slots (they also auto-populate from live telemetry).
4. **Invite** students with a link; set quotas; toggle queue / approval in Settings.
5. Students **design & print**; jobs auto-route to a compatible printer.

## How "real" is it?

Everything (roles, invites, printers, AMS color mapping, quotas, queue, approvals, usage/cost
tracking, the 3D design studio, job lifecycle) is implemented and runs on a local **SQLite**
file. Printing is **LAN-only**: real slicing in-process (OrcaSlicer), then FTPS upload + MQTT
`project_file` straight to the printer, with live status/AMS/camera over local MQTT.

Known gap: **H2-series (H2C/H2D)** printing needs a newer OrcaSlicer engine than we bundle, so
those models are auto-excluded from the queue for now — every other Bambu model prints.

## Desktop app

```bash
cd apps/electron && npm install
SPARKPRINT_URL=https://your-deployment npm start
```

## Deploy (on-site)

SparkPrint runs on a small always-on box **on the same network as the printers** (a Raspberry
Pi 5 is ideal). One script installs everything — Node, OrcaSlicer, a local SQLite database, a
systemd service, and an optional Cloudflare Tunnel to your own domain:

```bash
curl -fsSL https://raw.githubusercontent.com/sparkden/sparkprint/main/install.sh -o install.sh
sudo bash install.sh
```

See **[docs/PI-SETUP.md](docs/PI-SETUP.md)** and **[docs/LAN.md](docs/LAN.md)**. From source:
`npm install && npm run build -w @sparkprint/web && node apps/web/build`.

Hardening in place: sessions hashed at rest, printer LAN access codes never sent to the
browser, security headers + prod CSP, login/signup rate limiting, a `/healthz` probe, and
migrations applied on install.

See `PROGRESS.md` for the full status log and roadmap.
