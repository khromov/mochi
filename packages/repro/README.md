# `bun --hot` / `--watch` EISDIR reproduction

Demonstrates a Bun 1.3.14 bug where `bun --hot` (or `--watch`) causes the second `Bun.build()` call in a process to fail with EISDIR errors.

## Run

```sh
cd packages/repro

bun run repro:ok      # ✅ works — no --hot/--watch
bun run repro         # ❌ FAILS — uses --hot
bun run repro:watch   # ❌ FAILS — uses --watch
bun run clean         # remove build artifacts
```

## What happens

The client `Bun.build()` (target: `browser`) reads corrupted internal state left by the preceding SSR `Bun.build()`. It tries to resolve `highlight.js` files that aren't in the client dependency graph, gets EISDIR on those files, reports phantom `chunk-*.js` imports, and misattributes a `node:async_hooks` import to `highlight.js`.

## Conditions

All five are required — removing any one makes the bug disappear:

1. `--hot` or `--watch` flag
2. `highlight.js` imported before `Bun.build()` runs
3. First `Bun.build()` with Svelte compiler plugin, 34+ entrypoints with deep import trees
4. Second `Bun.build()` with Svelte compiler plugin, `target: 'browser'`
5. The compiled `.svelte` files live inside the `--hot` watch scope (same directory tree as the entry file)

## File layout

The reproduction script lives at `packages/site/src/_repro.ts` (not here) because condition 5 requires the entry file to share a directory tree with the `.svelte` pages that `Bun.build()` compiles. The scripts in this package invoke it via `bun --cwd=../site`.
