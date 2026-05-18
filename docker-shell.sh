#!/usr/bin/env bash
set -e

IMAGE_NAME="mochi"

echo "Building Docker image..."
docker build -t "$IMAGE_NAME" .

echo "Dropping into shell..."
docker run --rm -it -p 3333:3333 --entrypoint /bin/sh "$IMAGE_NAME"
