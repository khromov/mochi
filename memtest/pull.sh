#!/usr/bin/env bash
# Populate ./snapshots from the remote memtest box for offline analysis.
# Incremental: rsync skips files already present locally (size+mtime match),
# transfers only the missing ones, and prunes any local file no longer in the
# selected set (including ones deleted on the remote) — so re-running is cheap.
#
# Default: three snapshots spread across the run — oldest (baseline), midpoint
# (target), newest (final) — so `bun run memtest:analyze` diffs the WIDEST window
# and a slow leak has room to show (a narrow window of consecutive captures
# rarely surfaces gradual growth).
# ALL=1 (bun run memtest:pull-all): sync the ENTIRE series instead, for the
# trend/growth analysis (`bun run memtest:analyze --growth`), which needs every
# snapshot to see a shape's count climb hour over hour.
#
# Assumes SSH key auth is already set up (ssh k@<host> works without a password).
# Override the host/dir with REMOTE_HOST / REMOTE_DIR env vars.
set -euo pipefail

cd "$(dirname "$0")/.."

REMOTE_HOST="${REMOTE_HOST:-k@192.168.10.75}"
REMOTE_DIR="${REMOTE_DIR:-mochi/snapshots}" # relative to the remote user's $HOME
LOCAL_DIR="${SNAPSHOT_DIR:-$PWD/snapshots}"
ALL="${ALL:-}"

# heap-<ISO-timestamp> names sort lexicographically == chronologically. Basenames
# only — they become rsync --include filters against the source dir.
all="$(ssh "$REMOTE_HOST" "cd '$REMOTE_DIR' && ls -1 heap-*.heapsnapshot 2>/dev/null | sort")"
n="$(printf '%s' "$all" | grep -c .)"

if [ -n "$ALL" ]; then
  if [ "$n" -lt 1 ]; then
    echo "No heap-*.heapsnapshot files in ${REMOTE_HOST}:${REMOTE_DIR}" >&2
    exit 1
  fi
  echo "Selecting all ${n} snapshots on ${REMOTE_HOST}:${REMOTE_DIR} ..."
  files="$all"
else
  if [ "$n" -lt 3 ]; then
    echo "Need at least 3 heap-*.heapsnapshot files in ${REMOTE_HOST}:${REMOTE_DIR}, found ${n}" >&2
    exit 1
  fi
  echo "Selecting oldest / midpoint / newest snapshots on ${REMOTE_HOST}:${REMOTE_DIR} ..."
  # Rows 1, ceil(n/2), n — distinct for any n >= 3.
  files="$(printf '%s\n' "$all" | awk -v n="$n" 'NR==1 || NR==int((n+1)/2) || NR==n')"
fi
echo "$files" | sed 's/^/  /'

# Include only the selected files, exclude everything else, and let --delete
# (with --delete-excluded) prune any local file outside the selection. rsync's
# default size+mtime check then skips whatever's already present, so only the
# genuinely missing snapshots cross the wire. --partial resumes an interrupted
# multi-MB transfer instead of restarting it.
includes=()
if [ -n "$ALL" ]; then
  includes+=(--include='heap-*.heapsnapshot')
else
  while IFS= read -r f; do
    [ -n "$f" ] && includes+=(--include="$f")
  done <<<"$files"
fi

echo "Syncing to ${LOCAL_DIR} (existing files skipped, extras pruned) ..."
mkdir -p "$LOCAL_DIR"
rsync -az --partial --progress --delete --delete-excluded \
  "${includes[@]}" --exclude='*' \
  "${REMOTE_HOST}:${REMOTE_DIR}/" "$LOCAL_DIR/"

echo
echo "Local snapshots now:"
ls -1 "$LOCAL_DIR"/*.heapsnapshot
