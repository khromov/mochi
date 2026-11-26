# [BUG] `registerEsmEnvStrip`'s filter hard-codes POSIX separators, so dev-only Svelte code is never eliminated from client bundles built on Windows

**File:** [`packages/mochi/src/compiler/clientBuildLoaders.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/compiler/clientBuildLoaders.ts#L28-L30) (lines 28, 29, 30)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-platform-specific-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The `onLoad` filter is `/node_modules\/svelte\/src\/.*\.js$/` (L29), matched by Bun against the resolved module path. On Windows that path is backslash-separated, so the filter never matches and the handler never runs.

This codebase itself treats Bun plugin paths as carrying native separators in two independent places, which is what makes the mismatch concrete rather than theoretical: `prerenderModules.ts:30` and `:42` normalize an `onLoad` `args.path` with `toPosixPath()` before testing `/node_modules/`, and `ComponentRegistry.ts:848` uses `path.sep` for the same containment check on `args.path`. Bun's own release notes record the bundler emitting backslash-separated paths on Windows (v1.4.1: "bun build on Windows wrote backslash-separated asset paths"). `registerEsmEnvStrip` is the only filter in the repo that embeds a directory path rather than just an extension, and it is the only one that cannot be normalized in a handler — the matching happens inside Bun.

Consequence: Svelte's `import { DEV, BROWSER, NODE } from 'esm-env'` statements survive, `DEV`/`BROWSER`/`NODE` stay imported bindings rather than free identifiers, and so `clientBuildDefine()`'s `define` map (L17-24) does not substitute them — exactly the mechanism the comment on L26-27 describes as load-bearing for eliminating `if (DEV)` blocks. The values are still correct at runtime (the `production` condition resolves `DEV` to `false`), so nothing breaks; but every production island bundle and debug-bar bundle built on Windows silently retains Svelte's dev-mode warning/validation code, plus the `esm-env` modules themselves. Builds are platform-dependent in size, and a Windows CI leg or Windows-built release artifact ships dev-only code to browsers. CI cannot catch it because the build still succeeds.

## Recommendation

Make the filter separator-agnostic: `/node_modules[\\/]svelte[\\/]src[\\/].*\.js$/`. Add a unit test that builds a fixture importing a `node_modules/svelte/src/**.js`-shaped module and asserts the `esm-env` import is gone, or assert on the filter source directly so it cannot regress. Consider the same audit for any future filter that embeds a path segment rather than only an extension.

## Revalidation

**Verdict:** true-positive

The filter `/node_modules\/svelte\/src\/.*\.js$/` (clientBuildLoaders.ts:29) is unambiguously separator-dependent, and I confirmed it is load-bearing: node_modules/svelte/package.json maps `.` to `./src/index-client.js` (so Svelte really resolves under `node_modules/svelte/src/`), 49 files under svelte/src import from `esm-env`, and esm-env's exports resolve `DEV` through the `production`/`development` conditions — so without the strip, `DEV`/`BROWSER`/`NODE` stay imported bindings and Bun's `define` map in `clientBuildDefine()` (L17-24) cannot substitute them, exactly as the comment at L26-27 describes. I also confirmed this is the only Bun plugin filter in the repo that embeds a directory path: every other one (`IMAGE_FILE_FILTER`, `PRERENDER_MODULE_FILTER`, `MARKDOWN_FILE_FILTER`, `/\.svelte$/`, `/\.css$/`, the specifier-anchored ones) is extension- or specifier-only, and it is the only one that cannot be normalized inside the handler because the match happens inside Bun. The premise that Bun hands onLoad a native, backslash-separated path on Windows is strongly supported but is the one link I could not prove statically (I did not run code): the repo itself treats plugin `args.path` as native in two independent places — ComponentRegistry.ts:848 uses `${path.sep}node_modules${path.sep}` and prerenderModules.ts:30/42 normalize with `toPosixPath()` before testing `/node_modules/` — Bun's own changelog states the Windows separator 'may either be `\` or `/`' (v1.1.21 coverage fix) and that `bun build` on Windows wrote backslash-separated asset paths (v1.4.1), and `[\\/]` is the established esbuild-plugin convention for exactly this reason. No test exercises the strip (virtualModuleTemplate.test.ts's probe never imports svelte), so CI gives no signal either way. Impact is bundle size and platform-dependent output, not behaviour or security — values stay correct at runtime — so BUG, and the fix (`/node_modules[\\/]svelte[\\/]src[\\/].*\.js$/`) is risk-free.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-11-14)
