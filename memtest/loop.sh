#!/usr/bin/env bash
# Self-updating daily supervisor for the memtest harness. Each cycle it pulls the
# latest main, rebuilds the image (via run.sh), runs the harness for 24h, stops
# it, then repeats — so the box always exercises fresh code for memory
# regressions. Snapshots persist on the host mount and keep rotating across
# cycles; each is stamped with the git short-SHA it was captured under.
#
# The update loop lives here on the HOST, not in the container: the image COPIES
# the repo in at build time, so new source only enters a run via `docker build`.
#
# Run it under systemd for boot-survival + crash-restart (see
# memtest/mochi-memtest-loop.service), or manually: `bash memtest/loop.sh`.
# Override the 24h window with CYCLE_SECONDS for a quick end-to-end test.
#
# No `set -e`: the loop must outlive a failed pull/build/run, so fallible
# commands are guarded individually instead of aborting the supervisor.
set -uo pipefail

cd "$(dirname "$0")/.."

BRANCH="${MEMTEST_BRANCH:-main}"
CYCLE_SECONDS="${CYCLE_SECONDS:-86400}"          # 24h; lower it to test the cycle
FAIL_BACKOFF_SECONDS="${FAIL_BACKOFF_SECONDS:-3600}" # retry sooner than a full day if a build breaks
CONTAINER="${CONTAINER:-mochi-memtest}"          # names below are the ones run.sh reads
SNAPSHOT_DIR="${SNAPSHOT_DIR:-$PWD/snapshots}"
PORT="${PORT:-3333}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)] $*"; }

# Pull the tracked branch and, ONLY if this script itself changed, re-exec so the
# new supervisor logic takes effect. run.sh/driver.ts don't need this — they're
# re-read fresh each cycle (run.sh is invoked anew; driver.ts is re-copied by the
# rebuild). Infinite-loop-safe: after exec, HEAD is already at origin/$BRANCH, so
# fetch/merge are no-ops and the diff is empty, and it falls through to the run.
pull_and_maybe_reexec() {
  git config --global --add safe.directory "$PWD" 2>/dev/null || true

  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    log "working tree dirty — skipping pull (set MEMTEST_LOOP_RESET=1 to hard-reset)"
    if [ "${MEMTEST_LOOP_RESET:-0}" = "1" ]; then
      git reset --hard "origin/$BRANCH" || log "reset failed"
    fi
  fi

  local before after
  before="$(git rev-parse HEAD)"
  if ! git fetch --quiet origin "$BRANCH"; then
    log "git fetch failed — running current checkout, will retry next cycle"
    return 0
  fi
  if ! git merge --ff-only --quiet "origin/$BRANCH"; then
    log "ff-only merge failed (non-ff or dirty) — running current checkout, will retry next cycle"
    return 0
  fi
  after="$(git rev-parse HEAD)"

  if ! git diff --quiet "$before" "$after" -- memtest/loop.sh; then
    log "memtest/loop.sh changed ${before:0:7}..${after:0:7} — re-exec'ing supervisor"
    exec "$0" "$@"
  fi
}

# A systemd SIGTERM must stop the container promptly instead of leaving it up for
# the rest of the 24h window; the sleeps below background + wait so the trap fires.
trap 'log "signal received — stopping $CONTAINER"; docker stop "$CONTAINER" >/dev/null 2>&1 || true; exit 0' TERM INT

export CONTAINER SNAPSHOT_DIR PORT

log "memtest loop starting — branch=$BRANCH cycle=${CYCLE_SECONDS}s container=$CONTAINER"

while true; do
  pull_and_maybe_reexec "$@"
  export MEMTEST_GIT_SHA="$(git rev-parse --short HEAD)"

  # run.sh builds BEFORE it rm -f's the old container, so a broken main leaves the
  # previous good container running while we back off.
  if bash memtest/run.sh; then
    log "cycle started — running ${CYCLE_SECONDS}s on $MEMTEST_GIT_SHA"
    sleep "$CYCLE_SECONDS" &
    wait $!
    log "cycle window elapsed — stopping $CONTAINER"
    docker stop "$CONTAINER" >/dev/null 2>&1 || true
    docker image prune -f >/dev/null 2>&1 || true # reclaim daily-rebuild layer accretion
  else
    log "run.sh failed (build or run) — previous container (if any) left running; backing off ${FAIL_BACKOFF_SECONDS}s"
    sleep "$FAIL_BACKOFF_SECONDS" &
    wait $!
  fi
done
