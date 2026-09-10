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

## Slicing (runs with the app)

The slice worker runs **in-process with the web server** — it starts automatically, no
separate service to launch. It uses a CLI slicer if one is available, in this order:

1. **`SLICER_CMD`** — a full command template with `{model}` / `{outdir}` placeholders.
   This is the reliable way to load your Bambu profiles, e.g.:
   ```
   SLICER_CMD='/opt/orca/orca-slicer --load-settings "/profiles/x1c.json;/profiles/0.2mm.json" --load-filaments /profiles/pla.json --slice 1 --outputdir {outdir} {model}'
   ```
2. **`SLICER_BIN`** — a slicer binary (invoked PrusaSlicer/OrcaSlicer-style).
3. A slicer detected on `PATH` (`orca-slicer`, `prusa-slicer`, `superslicer`,
   `CuraEngine`, `bambu-studio`).

If none is configured, it **falls back to a geometry-based size estimate** (grams/time) so
the queue never gets stuck — jobs still assign to a printer. Real gcode requires a real
slicer + your machine/process/filament profiles.

To bundle OrcaSlicer in the deployment, either add it to the web image (see
`services/slicer/Dockerfile` for the apt packages + AppImage extraction) and set
`SLICER_CMD`, or run the separate `services/slicer` container from `docker-compose.yml`
(it subscribes to the same queue — pg-boss gives each job to one worker).

## Printing to the printers

SparkPrint starts prints through **Bambu's official cloud print task API — the same routes
Bambu Studio uses** (create project → upload the sliced 3mf to Bambu's storage →
`POST /my/task` with the `X-BBL-Client-Name: BambuStudio` headers). **No "Developer Mode"
is required for cloud printing.** Live status + AMS come over Bambu cloud MQTT.

Note: direct *control* commands (pause / resume / stop / unload filament) publish to the
printer's MQTT request topic, which Bambu restricts for third parties in Standard Mode
(Jan-2025). Those may not work unless the printer allows it; **starting prints via the
cloud task does not depend on it.** Request signing on the newest secured firmware may need
iteration against your account's responses.

## Going to real Bambu hardware

Set `BAMBU_MODE=cloud`, connect a (dedicated) Bambu account in **Admin → Printers**, and
put each printer in **Developer Mode**. See `docs/BAMBU.md` for the full protocol notes,
constraints, and the remaining cloud-print-dispatch milestone.
