#!/bin/sh
# Every two minutes: DIGI's order status, tracking and warehouse for Printshop's
# Supplier Order Management page. DIGI's API has no webhooks, so it is asked.
# Runs inside the backend container so it uses the app's database settings,
# DIGI key and Shippo key. flock skips a run while the last one is still going.
LOG=/var/log/decoinks-digi-orders.log
echo "=== $(date -Is) ===" >> "$LOG"
flock -n /tmp/decoinks-digi-orders.lock docker exec decoinks_backend node /app/scripts/sync-digi-orders.js --apply >> "$LOG" 2>&1 \
  || echo "skipped or failed (exit $?)" >> "$LOG"
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
