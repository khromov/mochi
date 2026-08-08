# mochi-docker

Internal docker-compose stack for local development: **PostgreSQL 15** + **[Adminer](https://www.adminer.org/)**. Not published, not deployed.

## Usage

`bun run dev` (repo root) auto-discovers this package and runs `docker compose up`. If Docker is not available (e.g. inside the dev container, which runs Postgres natively), the dev script prints a warning and idles so the other dev servers keep running.

- **Postgres**: `postgres://postgres:postgres@localhost:5433/postgres` (user `postgres`, password `postgres`, database `postgres`).
- **Adminer**: http://localhost:8081 — login with system `PostgreSQL`, server `postgres`, user `postgres`, password `postgres`, database `postgres`.

The host ports are `5433` (Postgres) and `8081` (Adminer), not `5432`/`8080`, so the stack coexists with the dev container's own native Postgres (5432) and code-server (8080). The container-internal ports are unchanged — from another compose service, reach Postgres at `postgres:5432`.

## Data

Postgres data lives in `./.db` (bind mount, gitignored) — no named volume. It survives `stop`/`down` and container recreation.

## Scripts

From the repo root:

```sh
bun run db:stop   # docker compose stop  — pause containers, keep data
bun run db:down   # docker compose down  — remove containers, keep data
bun run db:reset  # docker compose down + delete ./.db — fresh empty database next start
```

On Linux hosts the postgres image chowns `.db` to uid 999; if `db:reset` fails with a permission error, run `sudo rm -rf packages/docker/.db`.
