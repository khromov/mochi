# [BUG] `css-bundle-failed` compile errors are never cleared by `compileAll` and are re-pushed on every rebuild, leaving every page permanently 500-ing in dev

**File:** [`packages/mochi/src/compiler/ComponentRegistry.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/compiler/ComponentRegistry.ts#L929-L2501) (lines 929, 2207, 2296, 2501)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`compileAll`'s error-reconciliation filter (L929-934) drops stale `nested-hydration`, `defer-in-hydratable`, `unresolved-island`, `server-only-island`, and `hydrate-island-children` entries before recomputing them, and `scanFontSubsetRequests` (L2390) does the same for `font-subset-invalid`. `css-bundle-failed` is in neither list. It is pushed from seven sites (L2207, L2214, L2239, L2259, L2296, L2314, L2327) and cleared from exactly one — `rebundleImportedCss` (L2501), which the dev watcher only reaches on a `.css` file edit (`dev/devWatcher.ts:765` → `triggerCssReload` → L262).

Two consequences:

1. **Permanent site-wide 500.** `Mochi.ts:898-901` throws `MochiHttpError(500, formatCompileErrors(…))` for *every* page render whenever `registry.getErrors()` is non-empty. So a single `css-bundle-failed` entry 500s the whole app until either a `.css` file is touched or the process restarts — even after the real cause is fixed.

2. **Unbounded duplicate accumulation.** `bundleImportedCssBatch` filters `todo` on `!this.importedCssUrls.has(variant)` (L2178), and a failure never populates `importedCssUrls`, so the broken variant is retried on every `compileAll`. Each retry pushes another identical entry (the `.css` `onLoad` still fires on a compile-cache hit, so `importedCssPaths.size > 0` and L1232 calls `bundleImportedCss` again). Over a dev session the array and the rendered error page grow without bound.

The gap matters most for failures whose cause lives *outside* a `.css` file. Font-subset failures are pushed as `css-bundle-failed` from L2296, but the subset request is parsed from an import attribute in a `.ts`/`.svelte` file (`scanFontSubsetRequests`, L2382). Fixing that attribute changes the variant key (L2446 derives it from `hash(groups)`), so the new variant bundles cleanly — while the old error, keyed on the bare `cssPath`, lingers forever.

## Recommendation

Make `css-bundle-failed` reconcile like the other kinds. Simplest fix: inside `bundleImportedCssBatch`, before bundling, drop entries for the stylesheets about to be re-attempted — `const retry = new Set(todo.map((v) => this.importedCssSubsets.get(v)?.cssPath ?? v)); this.errors = this.errors.filter((e) => !(e.kind === 'css-bundle-failed' && retry.has(e.cssPath)));` — which both clears stale entries on success and prevents duplicates on repeated failure. Add a regression test that fails a CSS/font-subset bundle, fixes the cause via a non-`.css` file, recompiles, and asserts `getErrors()` is empty.

## Revalidation

**Verdict:** true-positive

Both halves confirmed. I enumerated every mutation of `this.errors` in ComponentRegistry.ts: the reconciliation filter at L929-934 drops only `nested-hydration`, `defer-in-hydratable`, `unresolved-island`, `server-only-island` and `hydrate-island-children`; L2390 drops only `font-subset-invalid`; `css-bundle-failed` is pushed from seven sites (L2207, 2214, 2239, 2259, 2296, 2314, 2327) and cleared from exactly one, L2501 inside `rebundleImportedCss`. I then checked the callers: `rebundleImportedCss` is reached only from devWatcher.ts:262 via `triggerCssReload`, which devWatcher.ts:765 gates on `filePath.endsWith('.css')`; `clearCompileCache()` (which would reset `errors` at L2106) has no callers anywhere in src. And Mochi.ts:898-901 throws `MochiHttpError(500, formatCompileErrors(...))` for every page render whenever `getErrors()` is non-empty. So a single `css-bundle-failed` entry 500s the whole app until a `.css` file is touched or the process restarts — even after the real cause is fixed. The duplicate-accumulation half is also right, and I found it splits cleanly by sub-path: the two early-return failures (L2207, L2214) never reach `importedCssUrls.set(variant, urlPath)` at L2347, so `todo`'s `!this.importedCssUrls.has(variant)` filter at L2178 re-attempts them on every forced `compileAll` and pushes an identical entry each time (the `.css` onLoad at L787 fires even on a compile-cache hit, so `importedCssPaths.size > 0` and L1232-1233 runs). The font-subset catch at L2292-2297 does not early-return, so that variant *is* registered and instead yields a single error that persists forever — and because the variant key is derived from `hash(groups)` at L2446 while the error is keyed on the bare `cssPath`, fixing the offending import attribute in a `.ts`/`.svelte` file creates a new clean variant while the stale error lingers. cssImports.test.ts:145 asserts one error after one compile but never tests clearing or repeat compiles, so the gap is untested. Dev-experience bug, not security: BUG.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-11-14)
