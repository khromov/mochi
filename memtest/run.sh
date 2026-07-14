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

echo "Building ${IMAGE} (Dockerfile.memtest)..."
docker build -f Dockerfile.memtest -t "$IMAGE" .

echo "Starting ${CONTAINER} — snapshots -> volume ${VOLUME}:/snapshots ..."
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -v "${VOLUME}:/snapshots" \
  -p "${PORT}:${PORT}" \
  "$IMAGE"

echo "Running. Follow logs with:  docker logs -f ${CONTAINER}"
echo "List snapshots with:        docker run --rm -v ${VOLUME}:/snapshots alpine ls -lh /snapshots"
