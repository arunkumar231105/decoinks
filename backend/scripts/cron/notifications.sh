#!/bin/sh
# Every minute (host crontab): Printshop notifications — the header bell and
# phone push. One run at a time.
LOG=/var/log/decoinks-notifications.log
flock -n /tmp/decoinks-notifications.lock docker exec decoinks_backend node /app/scripts/notify-watch.js >> "$LOG" 2>&1 \
  || echo "$(date -Is) skipped or failed (exit $?)" >> "$LOG"
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
