#!/usr/bin/env bash
set -euo pipefail

PG_VER="$(pg_lsclusters -h | awk '{print $1; exit}')"

# /run may be a fresh tmpfs on each container start; recreate the socket/lock
# dir with the ownership PostgreSQL expects. Idempotent.
sudo install -d -o postgres -g postgres -m 2775 /var/run/postgresql

if ! sudo pg_ctlcluster --skip-systemctl-redirect "$PG_VER" main status >/dev/null 2>&1; then
  sudo pg_ctlcluster --skip-systemctl-redirect "$PG_VER" main start
fi

until pg_isready -q -h 127.0.0.1 -p 5432; do sleep 0.5; done
