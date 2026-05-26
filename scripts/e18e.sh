#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/packages/mochi"

cleanup() {
  rm -f "$PKG/bun.lock"
  [ -f "$ROOT/.env.bak" ] && mv "$ROOT/.env.bak" "$ROOT/.env"
}
trap cleanup EXIT

[ -f "$ROOT/.env" ] && mv "$ROOT/.env" "$ROOT/.env.bak"
ln -sf "$ROOT/bun.lock" "$PKG/bun.lock"

cd "$PKG"
bunx @e18e/cli analyze "$@" || true
