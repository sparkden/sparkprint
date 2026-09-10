#!/bin/sh
# Run DB migrations, then start the SvelteKit (adapter-node) server.
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "FATAL: DATABASE_URL is not set." >&2
  exit 1
fi

echo "==> Applying database migrations…"
( cd /app/apps/web && node scripts/migrate.js )

echo "==> Starting SparkPrint on ${HOST:-0.0.0.0}:${PORT:-3000}"
exec node /app/apps/web/build
