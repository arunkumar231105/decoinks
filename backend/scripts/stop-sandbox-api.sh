#!/bin/sh
# Stop the sandbox API and nothing else.
#
# `pkill -f 'PORT=8001'` matched only the `sh -c` wrapper that started it —
# node's own argv is just "node server.js" — so the server survived every stop
# and kept serving the old code from the old directory. The port lives in the
# process environment, so that is what this reads. Production is PORT=8000 and
# is never a candidate.
found=0
for p in $(pgrep -f 'node server.js'); do
  [ -r "/proc/$p/environ" ] || continue
  if tr '\0' '\n' < "/proc/$p/environ" | grep -qx 'PORT=8001'; then
    kill "$p" 2>/dev/null && { echo "  stopped sandbox pid $p"; found=1; }
  fi
done
[ "$found" = 1 ] || echo "  no sandbox API was running"
