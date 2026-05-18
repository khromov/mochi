# Mochi (monorepo)

An SSR framework for [Svelte 5](https://svelte.dev/) + [Bun](https://bun.sh/) with islands-based selective hydration.

> **Early prototype.** Only use in production if you are brave!

## Goals

- Partial hydration — non-hydrated components aren't added to bundles
- Minimal bundle sizes
- Deploy anywhere Bun / `Bun.serve()` runs
- Optional SQLite via `bun:sqlite`

## Non-goals

- Full SPA router (use View Transition)
- Streaming (not in 0.x, possibly in 1.0)
- Running outside of Bun

## Repository layout

| Path             | What                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `packages/mochi` | The `mochi-framework` library — **full docs live in [its README](./packages/mochi#readme)** |
| `packages/site`  | Demo site showing framework usage                                                           |
| `packages/demos` | Standalone demos site (HN clone today) — deployed separately                                |

## Running locally

Two sites can run side-by-side; each has its own default port.

| Command             | Site                                        | Default port    |
| ------------------- | ------------------------------------------- | --------------- |
| `bun run dev`       | Both sites in parallel (per-package output) | `3333` + `3334` |
| `bun run dev:site`  | Just the main site (`packages/site`)        | `3333`          |
| `bun run dev:demos` | Just the demos site (`packages/demos`)      | `3334`          |

Override the port with `PORT=…` if needed (single-site commands only — `PORT` would collide if applied to both at once). Production equivalents are `bun run start`, `bun run start:demos`, and `bun run start:all`.

## Building

| Command               | Builds              |
| --------------------- | ------------------- |
| `bun run build:site`  | Just the main site  |
| `bun run build:demos` | Just the demos site |
| `bun run build`       | Both, in order      |

## Memory-leak test

`bun run test:leak` boots `packages/site` in production mode, drives a mix of
HTTP routes for a fixed duration, samples RSS via `ps` plus an in-process
`process.memoryUsage()` probe, and prints a pass/warn/fail verdict.

Defaults to a ~13-minute run (60s warmup + 10min workload + 60s cooldown @ 50
rps). Overrides:

```sh
bun run test:leak -- --duration=120 --warmup=30 --cooldown=30 --rps=80
bun run test:leak -- --skip-build              # reuse existing .mochi/
bun run test:leak -- --port=13334              # avoid port collision
```

The harness cleans + rebuilds the site by default so the manifest always
matches the on-disk chunks. Full timeline JSON lands in
`packages/mochi/scripts/leak/reports/<timestamp>.json`. See
[`packages/mochi/scripts/leak/README.md`](./packages/mochi/scripts/leak/README.md)
for verdict thresholds and route mix.

Sample output:

```
======================================================================
Leak test verdict: PASS
======================================================================
  • slope 0.12 MB/min, delta 4.1 MB, GC dips observed

Memory:
  baseline RSS:         312.4 MB
  final RSS:            316.5 MB
  delta:                4.1 MB
  workload slope:       0.12 MB/min  (r²=0.31, n=290)
  GC dip during load:   yes

Traffic:
  total requests:       30000
  errors:               0  (0.00%)
  latency p50/p95:      1.8 / 12.4 ms
  p95 creep:            -2%
```

## Deployment

Both sites build to their own Docker image and deploy to separate CapRover apps via `.github/workflows/build.yml` (matrix strategy).

| Site  | Dockerfile                             | GHCR image                    | CapRover app  | Deploy token secret |
| ----- | -------------------------------------- | ----------------------------- | ------------- | ------------------- |
| site  | `Dockerfile`                           | `ghcr.io/khromov/mochi`       | `mochi`       | `APP_TOKEN`         |
| demos | `packages/demos/Dockerfile.production` | `ghcr.io/khromov/mochi-demos` | `mochi-demos` | `APP_TOKEN_DEMOS`   |

## Install

```sh
bun add mochi-framework
```

## Documentation

**→ [packages/mochi/README.md](./packages/mochi#readme)**

## Contributing / releases

See [CONTRIBUTING.md](./CONTRIBUTING.md). Releases are automated via [release-please](https://github.com/googleapis/release-please) using Conventional Commits.

## License

MIT
