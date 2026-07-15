# Mochi

An SSR framework for [Svelte 5](https://svelte.dev/) + [Bun](https://bun.sh/) with islands-based selective hydration.

> **Early prototype.** Only use in production if you are brave!

## Quick start

```sh
bun create mochi@latest
```

(Requires `Bun >= 1.3.14`, [Why Bun?](https://mochi.fast/docs/why-bun/))

## Documentation

https://mochi.fast/

## Live demos

Example sites built with Mochi:

https://demos.mochi.fast/

## Setting up the development environment

```sh
curl -fsSL https://bun.com/install | bash # install bun if you don't have it already
bun i
bun dev
```

_Bun must be v1.3.14 or newer (see [`.bun-version`](./.bun-version))._

#### Available sites

- Documentation site: http://localhost:3333/
- Admin demo: http://localhost:3334/admin/
- Hacker News demo: http://localhost:3334/hn/front/
- Tailwind + Todo demo: http://localhost:3334/todo/
- Hello world minimal template: http://localhost:3335/
- Support form: http://localhost:3336/

## Goals

- Partial hydration — non-hydrated components aren't added to bundles
- Minimal bundle sizes
- Deploy anywhere Bun / `Bun.serve()` runs
- Optional SQLite via `bun:sqlite`

## Non-goals

- Full SPA router (use View Transition)
- Streaming (not in 0.x, possibly in 1.0)
- Running outside of Bun

See [PITCH.md](./PITCH.md) for a Mochi-vs-SvelteKit feature comparison.

## Repository layout

| Path               | What                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `packages/mochi`   | The `mochi-framework` library — **full docs live in [its README](./packages/mochi#readme)** |
| `packages/site`    | Documentation + demo site (`mochi.fast`)                                                    |
| `packages/demos`   | Standalone demos site (HN clone, admin, todo) — deployed separately                         |
| `packages/minimal` | Bare-bones hello-world template — also bundled by `create-mochi`                            |
| `packages/support` | Support form (`support.mochi.fast`) — deployed separately; the only site with SMTP config   |
| `packages/cli`     | `create-mochi` scaffolder — published to npm                                                |

## Running locally

Sites run side-by-side; each has its own default port.

| Command             | Site                                            | Default port             |
| ------------------- | ----------------------------------------------- | ------------------------ |
| `bun run dev`       | All workspaces with a `dev` script, in parallel | `3333` + `3334` + `3335` + `3336` |
| `bun run dev:site`  | Just the documentation site (`packages/site`)   | `3333`                   |
| `bun run dev:demos` | Just the demos site (`packages/demos`)          | `3334`                   |

Override the port with `PORT=…` if needed (single-site commands only — `PORT` would collide if applied to both at once). Production equivalents are `bun run start`, `bun run start:demos`, and `bun run start:all`.

## Building

| Command               | Builds              |
| --------------------- | ------------------- |
| `bun run build:site`  | Just the main site  |
| `bun run build:demos` | Just the demos site |
| `bun run build`       | Both, in order      |

## Quality checks

| Command              | What                                                         |
| -------------------- | ------------------------------------------------------------ |
| `bun run checks`     | `lint:fix` + `format` + `typecheck` + `test` (run before PR) |
| `bun run typecheck`  | `tsc --noEmit` across every workspace                        |
| `bun run test`       | `bun test` across every workspace                            |
| `bun run lint`       | `eslint .` (use `lint:fix` to autofix)                       |
| `bun run format`     | `prettier --write .` (use `format:check` in CI)              |
| `bun run loc`        | Lines-of-code report (`.github/scripts/loc-report.ts`)       |
| `bun run deps`       | Dependency report (`packages/mochi/scripts/dep-report.ts`)   |
| `bun run flamegraph` | Generate a flamegraph of the site (`scripts/flamegraph.ts`)  |

## Deployment

The two main sites (docs and demos) build to their own Docker image and deploy to separate CapRover apps via `.github/workflows/build.yml` (matrix strategy).

| Site  | Dockerfile                             | GHCR image                    | CapRover app  | Deploy token secret |
| ----- | -------------------------------------- | ----------------------------- | ------------- | ------------------- |
| site  | `Dockerfile`                           | `ghcr.io/khromov/mochi`       | `mochi`       | `APP_TOKEN`         |
| demos | `packages/demos/Dockerfile.production` | `ghcr.io/khromov/mochi-demos` | `mochi-demos` | `APP_TOKEN_DEMOS`   |

## Install

Scaffold a new app with [`create-mochi`](./packages/cli#readme):

```sh
bun create mochi@latest my-app
```

Then follow the [**Your first Mochi app**](https://mochi.fast/docs/your-first-mochi-app/) walkthrough for a four-step tour of routes, islands, and server islands.

Or add the framework to an existing project:

```sh
bun add mochi-framework
```

## Documentation

**→ [packages/mochi/README.md](./packages/mochi#readme)**

## Contributing / releases

See [CONTRIBUTING.md](./CONTRIBUTING.md). Releases are automated via [release-please](https://github.com/googleapis/release-please) using Conventional Commits.

## License

MIT
