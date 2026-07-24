#!/usr/bin/env bash
# Sync ./snapshots from the remote memtest box for offline analysis. Always
# downloads the ENTIRE series. Incremental: rsync skips files already present
# locally (size+mtime match), transfers only the missing ones, and prunes any
# local file no longer on the remote — so re-running after a few new captures is
# cheap. --partial resumes an interrupted multi-MB transfer instead of restarting.
#
# The analyzer decides which snapshots to use from whatever's local:
# `memtest:analyze` diffs oldest/midpoint/newest; `--growth` uses the whole set.
#
# Assumes SSH key auth is already set up (ssh k@<host> works without a password).
# Override the host/dir with REMOTE_HOST / REMOTE_DIR env vars.
set -euo pipefail

cd "$(dirname "$0")/.."

REMOTE_HOST="${REMOTE_HOST:-k@192.168.10.75}"
REMOTE_DIR="${REMOTE_DIR:-mochi/snapshots}" # relative to the remote user's $HOME
LOCAL_DIR="${SNAPSHOT_DIR:-$PWD/snapshots}"

echo "Syncing all snapshots from ${REMOTE_HOST}:${REMOTE_DIR} -> ${LOCAL_DIR}"
echo "(incremental: existing files skipped, remote-pruned files removed)"
mkdir -p "$LOCAL_DIR"
rsync -az --partial --progress --delete --delete-excluded \
  --include='heap-*.heapsnapshot' --exclude='*' \
  "${REMOTE_HOST}:${REMOTE_DIR}/" "$LOCAL_DIR/"

echo
echo "$(ls -1 "$LOCAL_DIR"/*.heapsnapshot 2>/dev/null | wc -l | tr -d ' ') snapshots in ${LOCAL_DIR}"
