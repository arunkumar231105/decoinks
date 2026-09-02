#!/bin/sh
# Nightly customer status refresh. Runs inside the backend container so it uses
# the same database the app does — nothing is configured twice, and there is no
# copy of the credentials on the host to go stale.
#
# A customer becomes Inactive after settings.customer_inactive_after_days (60)
# without a sales order or a payment, and Active again the moment they buy.
# 'blocked' and 'archived' are never touched: those are deliberate decisions.
LOG=/var/log/decoinks-customer-status.log
echo "=== $(date -Is) ===" >> "$LOG"
docker exec decoinks_backend node /app/scripts/refresh-customer-status.js --apply >> "$LOG" 2>&1
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
