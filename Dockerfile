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

# ── OrcaSlicer (real Bambu-printable G-code) ─────────────────────────────────────
# Extract the AppImage (no FUSE needed) to a fixed path the app auto-detects. Pin the
# version; override ORCA_URL to bump it. amd64 only — on other arches this stage is a no-op
# and the app falls back to the bundled Slic3r.
FROM node:22-bookworm-slim AS orca
ARG TARGETARCH=amd64
ARG ORCA_URL=https://github.com/SoftFever/OrcaSlicer/releases/download/v2.4.2/OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.4.2.AppImage
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    mkdir -p /opt/orca; \
    if [ "$TARGETARCH" = "amd64" ]; then \
      curl -fsSL "$ORCA_URL" -o /tmp/orca.AppImage; \
      chmod +x /tmp/orca.AppImage; \
      cd /opt/orca; /tmp/orca.AppImage --appimage-extract >/dev/null; \
      rm -f /tmp/orca.AppImage; \
    fi

# ── Runtime ──────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    STORAGE_DIR=/data/storage \
    BODY_SIZE_LIMIT=104857600 \
    PROTOCOL_HEADER=x-forwarded-proto \
    HOST_HEADER=x-forwarded-host \
    ORCA_APPRUN=/opt/orca/squashfs-root/AppRun

# tini for signals; xvfb + GL/GTK libs so OrcaSlicer slices headless; fonts for text on plate.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tini curl xvfb \
      libgl1 libegl1 libglu1-mesa libgtk-3-0 libgomp1 libnss3 \
      libwebkit2gtk-4.0-37 libsecret-1-0 fontconfig fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

# OrcaSlicer (extracted AppImage). Present only on amd64; harmless if the dir is empty.
COPY --from=orca /opt/orca /opt/orca

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
