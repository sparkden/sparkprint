# Deploying SparkPrint

Production image is a standard **SvelteKit adapter-node** server in a multi-stage
Dockerfile. It runs DB migrations on boot, then serves on `$PORT` (default 3000).

## Environment variables

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string. |
| `APP_SECRET` | ✅ (prod) | Long random string. Encrypts Bambu tokens + hashes sessions. `openssl rand -base64 48`. |
| `ORIGIN` | ✅* | Public URL, e.g. `https://print.school.edu`. *Not needed if the proxy sets `x-forwarded-proto`/`x-forwarded-host` (the image reads them via `PROTOCOL_HEADER`/`HOST_HEADER`). Without one, form POSTs are rejected as cross-site. |
| `STORAGE_DIR` | — | Defaults to `/data/storage` (mount a volume at `/data`). |
| `BAMBU_MODE` | — | `cloud` (default, real) or `mock` (dev only). See `docs/BAMBU.md`. |
| `BODY_SIZE_LIMIT` | — | Max upload bytes; image default 100 MB. |
| `PORT` / `HOST` | — | Default `3000` / `0.0.0.0`. |

## Coolify

1. **New Resource → Application → from your Git repo.** Build pack: **Dockerfile**
   (auto-detected at repo root).
2. Add a **Postgres** database resource (or point `DATABASE_URL` at an existing one).
3. Set env vars: `DATABASE_URL`, `APP_SECRET`, and `BAMBU_MODE`. Set the domain in Coolify;
   it terminates TLS and forwards `x-forwarded-*`, so you can skip `ORIGIN`.
4. Add a **persistent volume** mounted at `/data` (models + sliced output).
5. Port: **3000**. Health check path: **`/healthz`** (the image also has a Docker HEALTHCHECK).
6. Deploy. Migrations run automatically on each boot; the app is idempotent.

First run: open the site → **Sign up** to create your lab (that user becomes owner).

## Docker / docker-compose (self-host)

```bash
cp apps/web/.env.example .env         # fill in APP_SECRET, etc.
APP_SECRET="$(openssl rand -base64 48)" docker compose up -d --build
# → http://localhost:3000
```

`docker-compose.yml` brings up Postgres + the web app with volumes for data.

## Images

GitHub Actions publishes `ghcr.io/<owner>/sparkprint:latest` (and per-tag/sha) on pushes
to `main` and `v*` tags (`.github/workflows/docker.yml`). Pull and run:

```bash
docker run -p 3000:3000 \
  -e DATABASE_URL=... -e APP_SECRET=... -e ORIGIN=https://... \
  -v sparkprint-data:/data \
  ghcr.io/<owner>/sparkprint:latest
```

## CI

`.github/workflows/ci.yml` runs type-check + unit tests + build on every push/PR.

## The slicer worker

Real printing needs the server-side slicer container (`services/slicer`, OrcaSlicer CLI).
`docker-compose.yml` includes it; it shares the DB (job queue) and the `/data` storage
volume with the web app. On Coolify, deploy it as a second resource from
`services/slicer/Dockerfile` with the same `DATABASE_URL` + storage volume. You must
provision machine/process/filament **profile JSONs** into `/opt/orca/profiles` (from
OrcaSlicer's `resources/profiles/BBL`) and may need to tune `SLICER_CMD` for your
OrcaSlicer version. Without the slicer running, submitted jobs sit in `slicing`.

## Going to real Bambu hardware

Set `BAMBU_MODE=cloud`, connect a (dedicated) Bambu account in **Admin → Printers**, and
put each printer in **Developer Mode**. See `docs/BAMBU.md` for the full protocol notes,
constraints, and the remaining cloud-print-dispatch milestone.
