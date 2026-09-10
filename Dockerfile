# syntax=docker/dockerfile:1
# ──────────────────────────────────────────────────────────────────────────────
# SparkPrint — production image (SvelteKit adapter-node).
# Works with Coolify's "Dockerfile" build pack. Runs DB migrations on boot, then
# starts the server. Configure via env (see DEPLOY.md): DATABASE_URL, APP_SECRET,
# ORIGIN or PROTOCOL_HEADER/HOST_HEADER, BAMBU_MODE, STORAGE_DIR.
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS base
WORKDIR /app
# Don't download the Electron binary in the image (desktop app is built separately).
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
# Workspace manifests (copied first for layer caching).
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/electron/package.json apps/electron/package.json
COPY services/slicer/package.json services/slicer/package.json
COPY services/bridge/package.json services/bridge/package.json

# ── Full deps + build ──────────────────────────────────────────────────────────
FROM base AS build
RUN npm ci
COPY . .
RUN npm run build -w @sparkprint/web

# ── Production deps only ─────────────────────────────────────────────────────────
FROM base AS prod-deps
RUN npm ci --omit=dev

# ── Runtime ──────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    STORAGE_DIR=/data/storage \
    BODY_SIZE_LIMIT=104857600 \
    PROTOCOL_HEADER=x-forwarded-proto \
    HOST_HEADER=x-forwarded-host

# tini for correct signal handling (graceful shutdown of the MQTT manager).
RUN apt-get update && apt-get install -y --no-install-recommends tini curl && rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/web/build ./apps/web/build
COPY --from=build /app/apps/web/drizzle ./apps/web/drizzle
COPY --from=build /app/apps/web/scripts ./apps/web/scripts
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Non-root + writable storage volume.
RUN useradd --create-home --uid 10001 app \
 && mkdir -p /data/storage && chown -R app:app /data /app
USER app
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "./entrypoint.sh"]
