#!/bin/sh
# Every ten minutes: DIGI's order status, tracking and warehouse for Printshop's
# Supplier Order Management page. Runs inside the backend container so it uses
# the app's database settings, DIGI key and Shippo key.
LOG=/var/log/decoinks-digi-orders.log
echo "=== $(date -Is) ===" >> "$LOG"
docker exec decoinks_backend node /app/scripts/sync-digi-orders.js --apply >> "$LOG" 2>&1
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
