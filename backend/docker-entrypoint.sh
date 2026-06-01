#!/bin/sh
# docker-entrypoint.sh
# Runs before the Node server on every container start.
# Postgres is guaranteed healthy (depends_on condition: service_healthy).
set -e

echo "[entrypoint] Ensuring migration baseline..."
node migrations/ensure-baseline.js

echo "[entrypoint] Running pending migrations..."
node migrations/run.js

echo "[entrypoint] Starting server..."
exec "$@"
