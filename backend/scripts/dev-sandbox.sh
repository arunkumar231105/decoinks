#!/usr/bin/env bash
# A sandbox that mirrors production, for trying schema changes before they touch
# the real database.
#
# Nothing here writes to decoinks_db. The sandbox is a separate database on the
# same server, cloned from production, with its own backend process on port 8001.
# Production keeps running on 8000 throughout.
#
#   ./dev-sandbox.sh refresh   drop and re-clone the sandbox from production
#   ./dev-sandbox.sh migrate   run pending migrations against the sandbox only
#   ./dev-sandbox.sh serve     start the sandbox API on :8001 (production stays on :8000)
#   ./dev-sandbox.sh test      run the API smoke test against the sandbox
#   ./dev-sandbox.sh diff      compare sandbox and production schemas
#   ./dev-sandbox.sh pending   list migrations the sandbox has and production does not
#   ./dev-sandbox.sh stop      stop the sandbox API
#   ./dev-sandbox.sh promote   run the same migrations against PRODUCTION (asks first)
set -euo pipefail

PG=decoinks_postgres
API=decoinks_backend
PROD=decoinks_db
DEV=decoinks_dev
DEV_URL="postgresql://postgres:decoinks_pass@postgres:5432/${DEV}"
MIGRATIONS_DIR="$(cd "$(dirname "$0")/../migrations" && pwd)"

psql_dev() { docker exec "$PG" psql -U postgres -d "$DEV" "$@"; }
psql_prod() { docker exec "$PG" psql -U postgres -d "$PROD" "$@"; }

case "${1:-}" in
  refresh)
    echo "Cloning ${PROD} → ${DEV} (production is only read)…"
    docker exec "$PG" psql -U postgres -c "DROP DATABASE IF EXISTS ${DEV};" >/dev/null
    docker exec "$PG" psql -U postgres -c "CREATE DATABASE ${DEV};" >/dev/null
    docker exec "$PG" sh -c "pg_dump -U postgres --no-owner --no-privileges ${PROD} | psql -U postgres -q -d ${DEV}" >/dev/null
    for db in "$PROD" "$DEV"; do
      printf '%-14s ' "$db"
      docker exec "$PG" psql -U postgres -d "$db" -t -A -c \
        "SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')||' tables, '||(SELECT count(*) FROM _migrations)||' migrations';"
    done
    ;;
  migrate)
    # Sandbox migrations live in their own folder inside the API container, and
    # deliberately not in /app/migrations. The container's entrypoint runs every
    # .sql file in that folder against DATABASE_URL on boot, and on a normal boot
    # DATABASE_URL is production — so a file left there is applied to production
    # by the next restart, with nobody asking for it. Keeping unapproved work
    # here means a restart cannot promote it by accident.
    for f in "${MIGRATIONS_DIR}"/*.sql; do
      [ -e "$f" ] || continue
      docker cp "$f" "$API":/app/sandbox-migrations/ >/dev/null
    done
    docker exec "$API" sh -c "cp -f /app/migrations/run.js /app/sandbox-migrations/run.js"
    docker exec "$API" sh -c "DATABASE_URL='${DEV_URL}' node /app/sandbox-migrations/run.js" | tail -8
    ;;
  pending)
    # What the sandbox has that production has not.
    docker exec "$PG" sh -c "
      psql -U postgres -d ${DEV}  -t -A -c \"SELECT filename FROM _migrations ORDER BY 1\" > /tmp/dev.mig
      psql -U postgres -d ${PROD} -t -A -c \"SELECT filename FROM _migrations ORDER BY 1\" > /tmp/prod.mig
      comm -23 /tmp/dev.mig /tmp/prod.mig"
    ;;
  serve)
    docker exec -d "$API" sh -c "DATABASE_URL='${DEV_URL}' PORT=8001 node server.js > /tmp/dev-backend.log 2>&1"
    sleep 6
    docker exec "$API" sh -c 'tail -2 /tmp/dev-backend.log'
    echo "sandbox API on :8001 — production untouched on :8000"
    ;;
  test)
    docker exec "$API" sh -c "SMOKE_BASE=http://localhost:8001/api DATABASE_URL='${DEV_URL}' node scripts/smoke-test-api.js"
    ;;
  diff)
    echo "Tables in the sandbox that production does not have:"
    docker exec "$PG" sh -c "
      psql -U postgres -d ${DEV}  -t -A -c \"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1\" > /tmp/dev.tables
      psql -U postgres -d ${PROD} -t -A -c \"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1\" > /tmp/prod.tables
      comm -23 /tmp/dev.tables /tmp/prod.tables | sed 's/^/  + /'
      echo 'Tables production has that the sandbox does not:'
      comm -13 /tmp/dev.tables /tmp/prod.tables | sed 's/^/  - /'"
    ;;
  stop)
    docker exec "$API" sh -c "pkill -f 'PORT=8001' || true"
    echo "sandbox API stopped"
    ;;
  promote)
    echo "This runs the pending migrations against PRODUCTION (${PROD})."
    read -r -p "Type the database name to confirm: " answer
    [ "$answer" = "$PROD" ] || { echo "aborted"; exit 1; }
    docker exec "$API" node migrations/run.js | tail -8
    ;;
  *)
    sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
