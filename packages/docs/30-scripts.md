---
title: 'Scripts'
slug: scripts
description: 'Reference for the root package.json scripts that run dev, build, test, lint, and format across the monorepo.'
---

## Scripts

Root `package.json` exposes a set of `bun run` scripts that fan out into the workspace packages. Run them from the repo root.

```sh
bun install
bun run dev       # development mode
bun run start     # production mode
```

### Reference

- `dev`: run every workspace's `dev` in parallel with `MODE=development` (site on `3333`, demos on `3334`).
- `dev:site`: dev server for `packages/site` only.
- `dev:demos`: dev server for `packages/demos` only.
- `start`: production server for `packages/site`.
- `start:site`: alias for `start`.
- `start:demos`: production server for `packages/demos`.
- `start:all`: production servers for every workspace, in parallel.
- `build`: pre-build islands across every workspace (topologically ordered).
- `build:site`: pre-build islands for `packages/site` only.
- `build:demos`: pre-build islands for `packages/demos` only.
- `clean`: remove `.mochi/` build artifacts in every workspace.
- `typecheck`: `tsc --noEmit` across every workspace; alias `tsc`.
- `test`: run `bun test` in every workspace.
- `test:leak`: run the long-lived leak-detection script at `packages/mochi/scripts/leak/runLeakTest.ts`.
- `lint`: `eslint .` (ignores `.mochi/`, `packages/site/.mochi/`, `.claude/`).
- `lint:fix`: `eslint . --fix`.
- `format`: `prettier --write .`.
- `format:check`: `prettier --check .` — used by CI.
- `loc`: lines-of-code report via `.github/scripts/loc-report.ts`.

### Filtering and single tests

Multi-package scripts use `bun --filter='*' run <script>`, which runs every workspace's matching script in topological order and parallelises siblings.

Run a single test file directly with `bun test`:

```sh
bun test packages/mochi/src/forms.test.ts
bun test packages/mochi/src/forms.test.ts -t 'fail returns 400'
```

Do **NOT** commit `.mochi/` to version control; instead, run `bun run clean` to remove it.
