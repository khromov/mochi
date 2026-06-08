#!/usr/bin/env bash
set -e

IMAGE_NAME="mochi"

echo "Building Docker image..."
docker build -f Dockerfile.production --build-arg WORKSPACE=minimal --build-arg PORT=3335 -t "$IMAGE_NAME" .

echo "Dropping into shell..."
docker run --rm -it -p 3335:3335 --entrypoint /bin/sh "$IMAGE_NAME"
