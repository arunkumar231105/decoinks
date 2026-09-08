#!/bin/sh
# Hourly courier check. Runs inside the backend container so it uses the same
# database settings and Shippo key the app does — nothing is configured twice.
#
# Output goes to a log, not to mail, so a failing courier API does not fill the
# root mailbox night after night.
LOG=/var/log/decoinks-shipment-tracking.log
echo "=== $(date -Is) ===" >> "$LOG"
# Two halves of the same hour. First bring back any label the account bought
# elsewhere — Shippo's own dashboard, another tool — because a parcel the book
# has never heard of cannot be tracked. Then refresh what the couriers say.
docker exec decoinks_backend node /app/scripts/pull-labels-from-shippo.js --apply >> "$LOG" 2>&1
# Then join any parcel that is still loose to its sales order. A label bought
# the day after the order arrives before the order can be matched to it, so
# matching once at insert time left those parcels loose for good. This looks at
# every unattached parcel each cycle, which is what makes a shipment appear on
# its order by itself the day after it is created.
docker exec decoinks_backend node /app/scripts/attach-loose-parcels.js --apply >> "$LOG" 2>&1
docker exec decoinks_backend node /app/scripts/sync-shipment-tracking.js --apply >> "$LOG" 2>&1
# Keep the last 2000 lines; a year of hourly runs is otherwise a large file.
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
