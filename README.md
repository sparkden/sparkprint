# SparkPrint

Cloud 3D-printing platform for schools running Bambu Lab printers. Students import and
design models and pick a color in the browser; prints route to the next available printer
that has the right filament loaded. Admins connect one Bambu account, map AMS colors,
invite students, set per-student quotas, and optionally gate every print behind approval —
so a whole lab runs without sharing a single Bambu login.

Built with **SvelteKit 2 + Svelte 5**, **Tailwind v4** (Sparkden design system),
**PostgreSQL + Drizzle**, with a Three.js design studio and worker services for slicing
and Bambu connectivity.

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

1. **Sign up** → creates your lab; you're the owner.
2. **Connect Bambu** (Printers page) → imports printers + AMS. *(Uses a mock provider
   until the bridge/cloud API is wired — see below. You can also add printers manually.)*
3. **Map colors** on each printer's AMS slots.
4. **Invite** students with a link; set quotas; toggle queue / approval in Settings.
5. Students **design & print**; jobs auto-route to a compatible printer.

## How "real" is it?

Everything in the platform (orgs, roles, invites, printers, AMS color mapping, quotas,
queue, approvals, usage/cost tracking, the 3D design studio, job lifecycle) is fully
implemented and runs against Postgres today. Two integrations are abstracted behind
adapters with working mocks so the product is usable before hardware/binaries are present:

- **Slicing** (`apps/web/src/lib/server/slicer.ts`) — a `MockSlicer` estimates grams/time
  from model geometry. Swap in `services/slicer` (BambuStudio CLI) for real slicing.
- **Bambu connectivity** (`apps/web/src/lib/server/bambu/`) — a `MockBambuProvider`
  provisions demo printers/AMS. Swap in `services/bridge` (cloud/LAN MQTT) to go live.

Each adapter has a single `getX()` factory; implementing the real class is the only change
needed. See the headers in `services/slicer/src/index.js` and `services/bridge/src/index.js`.

## Desktop app

```bash
cd apps/electron && npm install
SPARKPRINT_URL=https://your-deployment npm start
```

## Deploy (production)

Production is a containerized adapter-node server. See **[DEPLOY.md](DEPLOY.md)** for the
Coolify guide and env vars. TL;DR:

```bash
cp apps/web/.env.example .env   # set APP_SECRET etc.
docker compose up -d --build    # Postgres + web on :3000
```

Hardening in place: sessions hashed at rest, Bambu tokens AES-256-GCM encrypted,
security headers + prod CSP, login/signup rate limiting, non-root container,
`/healthz` probe, migrations-on-boot. CI (type-check + tests + build) and a GHCR image
build run via GitHub Actions.

See `PROGRESS.md` for the full status log and roadmap.
