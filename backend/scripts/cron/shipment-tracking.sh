#!/bin/sh
# Hourly courier check. Runs inside the backend container so it uses the same
# database settings and Shippo key the app does — nothing is configured twice.
#
# Output goes to a log, not to mail, so a failing courier API does not fill the
# root mailbox night after night.
LOG=/var/log/decoinks-shipment-tracking.log
echo "=== $(date -Is) ===" >> "$LOG"
docker exec decoinks_backend node /app/scripts/sync-shipment-tracking.js --apply >> "$LOG" 2>&1
# Keep the last 2000 lines; a year of hourly runs is otherwise a large file.
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
