# syntax=docker/dockerfile:1
# SparkPrint slicer worker — OrcaSlicer headless CLI + the Node consumer.
# Build from the repo root:  docker build -f services/slicer/Dockerfile -t sparkprint-slicer .
FROM node:22-bookworm-slim

# Pin the OrcaSlicer AppImage (override at build time for a different version/arch).
ARG ORCA_URL="https://github.com/SoftFever/OrcaSlicer/releases/download/v2.2.0/OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.2.0.AppImage"

# Runtime libs OrcaSlicer links against, even for CLI slicing, + a virtual display.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates xvfb \
      libgl1 libglu1-mesa libgtk-3-0 libwebkit2gtk-4.1-0 \
      libnotify4 libsecret-1-0 libosmesa6 fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

# Fetch + extract the AppImage (no FUSE needed with --appimage-extract).
WORKDIR /opt/orca
RUN curl -fsSL "$ORCA_URL" -o orca.AppImage \
 && chmod +x orca.AppImage \
 && ./orca.AppImage --appimage-extract >/dev/null \
 && rm orca.AppImage \
 && mkdir -p /opt/orca/profiles

# CLI wrapper runs the slicer under a virtual framebuffer.
RUN printf '#!/bin/sh\nexec xvfb-run -a /opt/orca/squashfs-root/AppRun "$@"\n' > /usr/local/bin/orca-slicer \
 && chmod +x /usr/local/bin/orca-slicer

ENV SLICER_BIN=/usr/local/bin/orca-slicer \
    SLICER_PROFILE_DIR=/opt/orca/profiles \
    STORAGE_DIR=/data/storage \
    NODE_ENV=production

# Node consumer (standalone install — just pg-boss + postgres).
WORKDIR /app
COPY services/slicer/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY services/slicer/src ./src

VOLUME ["/data"]
CMD ["node", "src/index.js"]

# NOTE: provision machine/process/filament profile JSONs into /opt/orca/profiles
# (copy from OrcaSlicer's resources/profiles/BBL). See docs/BAMBU.md.
