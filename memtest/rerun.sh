#!/usr/bin/env bash
# Force an immediate fresh memtest cycle: restart the supervisor so it stops the
# current container, re-pulls the tracked branch, rebuilds, and starts a new 24h
# window. Use after landing a change (e.g. a new run.sh flag) that you want live
# now instead of at the next daily rebuild.
#
# NOTE: resets the site heap to a fresh baseline, so the snapshot series has a
# discontinuity at this point — expected, not a leak signal.
set -euo pipefail

UNIT="${MEMTEST_UNIT:-mochi-memtest-loop}"

if ! systemctl list-unit-files "$UNIT.service" >/dev/null 2>&1; then
  echo "error: systemd unit '$UNIT' not found — is the loop installed? (see memtest/README.md)" >&2
  exit 1
fi

echo "Restarting $UNIT (stop container -> pull -> rebuild -> new cycle)..."
sudo systemctl restart "$UNIT"
echo "Done. Follow it with:  journalctl -u $UNIT -f"
