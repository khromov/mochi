#!/usr/bin/env bash
# Build and launch the memory-regression harness for packages/site.
# Snapshots land in the named volume `mochi-heapsnapshots` (override with VOLUME).
# Runs detached with restart-on-crash so it survives an OOM/site death.
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE="${IMAGE:-mochi-memtest}"
VOLUME="${VOLUME:-mochi-heapsnapshots}"
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

echo "Starting ${CONTAINER} — snapshots -> volume ${VOLUME}:/snapshots ..."
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -e PORT="$PORT" \
  -v "${VOLUME}:/snapshots" \
  ${publish_args[@]+"${publish_args[@]}"} \
  "$IMAGE"

echo "Running. Follow logs with:  docker logs -f ${CONTAINER}"
echo "List snapshots with:        docker run --rm -v ${VOLUME}:/snapshots alpine ls -lh /snapshots"
