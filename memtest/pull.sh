#!/usr/bin/env bash
# Populate ./snapshots from the remote memtest box for offline analysis.
# Wipes the local snapshots folder, then copies three heap snapshots spread
# across the run — oldest (baseline), midpoint (target), newest (final) — so
# `bun run memtest:analyze` diffs the WIDEST window and a slow leak has room to
# show. A narrow window of consecutive captures rarely surfaces gradual growth.
#
# Assumes SSH key auth is already set up (ssh k@<host> works without a password).
# Override the host/dir with REMOTE_HOST / REMOTE_DIR env vars.
set -euo pipefail

cd "$(dirname "$0")/.."

REMOTE_HOST="${REMOTE_HOST:-k@192.168.10.75}"
REMOTE_DIR="${REMOTE_DIR:-mochi/snapshots}" # relative to the remote user's $HOME
LOCAL_DIR="${SNAPSHOT_DIR:-$PWD/snapshots}"

echo "Selecting oldest / midpoint / newest snapshots on ${REMOTE_HOST}:${REMOTE_DIR} ..."
# heap-<ISO-timestamp> names sort lexicographically == chronologically. Pull the
# first, middle, and last of the sorted list. Basenames only — rsync --files-from
# wants them relative to the source dir.
all="$(ssh "$REMOTE_HOST" "cd '$REMOTE_DIR' && ls -1 heap-*.heapsnapshot 2>/dev/null | sort")"
n="$(printf '%s' "$all" | grep -c .)"
if [ "$n" -lt 3 ]; then
  echo "Need at least 3 heap-*.heapsnapshot files in ${REMOTE_HOST}:${REMOTE_DIR}, found ${n}" >&2
  exit 1
fi
# Rows 1, ceil(n/2), n — distinct for any n >= 3.
files="$(printf '%s\n' "$all" | awk -v n="$n" 'NR==1 || NR==int((n+1)/2) || NR==n')"
echo "$files" | sed 's/^/  /'

echo "Clearing ${LOCAL_DIR} ..."
mkdir -p "$LOCAL_DIR"
rm -f "$LOCAL_DIR"/*.heapsnapshot

echo "Copying ..."
printf '%s\n' "$files" | rsync -az --progress --files-from=- "${REMOTE_HOST}:${REMOTE_DIR}/" "$LOCAL_DIR/"

echo
echo "Local snapshots now (analyzer will use these three):"
ls -1 "$LOCAL_DIR"/*.heapsnapshot
