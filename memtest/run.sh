#!/usr/bin/env bash
# Build and launch the memory-regression harness for packages/site.
# Snapshots land in ./snapshots next to the repo (override with SNAPSHOT_DIR),
# so they can be scp'd off the box directly — no `docker cp` out of a volume.
# Runs detached with restart-on-crash so it survives an OOM/site death.
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE="${IMAGE:-mochi-memtest}"
SNAPSHOT_DIR="${SNAPSHOT_DIR:-$PWD/snapshots}"
CONTAINER="${CONTAINER:-mochi-memtest}"
PORT="${PORT:-3333}"
# The port stays unpublished by default: the driver reaches the site over
# 127.0.0.1 inside the container, and publishing would expose /_heapsnapshot
# (a full heap dump) and /__mochi/health/memory to the network. Set PUBLISH to
# a host address to map it anyway — PUBLISH=127.0.0.1 for local-only access.
PUBLISH="${PUBLISH:-}"

echo "Building ${IMAGE} (Dockerfile.memtest)..."
docker build -f Dockerfile.memtest -t "$IMAGE" .

publish_args=()
if [ -n "$PUBLISH" ]; then
  publish_args=(-p "${PUBLISH}:${PORT}:${PORT}")
  echo "Publishing site on ${PUBLISH}:${PORT}"
fi

# A bind mount keeps the host directory's ownership, overriding the image's
# `chown bun:bun /snapshots` — so without this the unprivileged container user
# can't write and every capture fails. Read the uid out of the image rather
# than assuming 1000, in case the base image ever renumbers `bun`.
mkdir -p "$SNAPSHOT_DIR"
read -r uid gid <<<"$(docker run --rm --entrypoint sh "$IMAGE" -c 'id -u; id -g' | tr '\n' ' ')"
if ! chown "${uid}:${gid}" "$SNAPSHOT_DIR" 2>/dev/null; then
  echo "warning: could not chown ${SNAPSHOT_DIR} to ${uid}:${gid} — re-run with sudo if captures fail" >&2
fi

echo "Starting ${CONTAINER} — snapshots -> ${SNAPSHOT_DIR} ..."
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -e PORT="$PORT" \
  -e MEMTEST_GIT_SHA="${MEMTEST_GIT_SHA:-}" \
  -v "${SNAPSHOT_DIR}:/snapshots" \
  ${publish_args[@]+"${publish_args[@]}"} \
  "$IMAGE"

echo
echo "Running. Follow logs with:  docker logs -f ${CONTAINER}"
echo "Snapshots appear in:        ${SNAPSHOT_DIR}"
echo "Check it's alive:           docker ps --filter name=${CONTAINER}"
# `docker stop` also clears the unless-stopped policy, so it stays down across a
# reboot; `rm` only removes the container — snapshots live on the host mount.
echo "Stop the run:               docker stop ${CONTAINER}"
echo "Stop and remove it:         docker stop ${CONTAINER} && docker rm ${CONTAINER}"
