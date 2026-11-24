# [BUG] A nested `mochi:*` directive inside a `mochi:defer` / `mochi:clientOnly` child fragment throws a raw MagicString error instead of a framework compile error

**File:** [`packages/mochi/src/compiler/svelteAstPreprocess.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/compiler/svelteAstPreprocess.ts#L260-L433) (lines 260, 347, 433)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

Both the `clientOnly` branch (L260) and the `server` branch (L347) call `s.overwrite(comp.start, comp.end, replacement)` and *then* call `next()` (L433), which makes zimmerframe descend into `comp.fragment`. Any child `Component` carrying a `mochi:*` directive then calls `s.overwrite(child.start, child.end, …)` on a sub-range of the already-overwritten parent range.

MagicString refuses that. `node_modules/magic-string/dist/index.mjs:1294-1297`:

  if (chunk.edited && chunk.content.length) {
    throw new MagicStringError(`cannot split a chunk that has already been edited (…)`);
  }

So the preprocessor throws out of `cachedPreprocessHydratable`, the Svelte `onLoad` rejects, and `compileAll` surfaces it as `Svelte SSR build failed: … cannot split a chunk that has already been edited (12:4 – "<Spinner mochi:hydrate />")` — a bundler-internal message with no hint about the actual mistake. It also bypasses the designed error channel entirely: `UnresolvedIslandError`'s doc comment (L36-41) explains that island problems are pushed to `errors` *rather than thrown* "so the dev error page can render it and the dev watcher can clear it on fix".

The comment at L232-233 asserts the opposite of what happens — "Static markup only: nested `mochi:*` islands stay untransformed and get wiped on mount" — so the behaviour was assumed, not verified. There is no test for it: `compiler/svelteAstPreprocess.test.ts` covers children on `mochi:hydrate` (a proper `hydrate-children` error) and plain-`<div>` children on `mochi:defer mochi:hydrate`, but never a directive-carrying child.

## Recommendation

Detect the nesting before editing: when a directive-bearing component's `comp.fragment` contains a descendant `Component` with any `mochi:*` directive, push a dedicated `PreprocessIslandError` (e.g. `reason: 'nested-island-fallback'`) naming parent and child, skip the overwrite, and add a `MochiCompileError` case in `ComponentRegistry.formatCompileError`. Alternatively, mark the subtree as visited so `next()` does not re-enter an already-overwritten range. Add a test covering `mochi:hydrate`, `mochi:defer`, and `mochi:clientOnly` children under both `mochi:defer` and `mochi:clientOnly` parents.

## Revalidation

**Verdict:** true-positive

I traced this to the MagicString source rather than trusting the claim. node_modules/magic-string/dist/index.mjs: `update()` calls `_split(start)` then `_split(end)` (L1051-1052) before applying the edit, and `_splitChunk` throws `MagicStringError('cannot split a chunk that has already been edited ...')` when `chunk.edited && chunk.content.length` (L1294-1297). After the parent's `s.overwrite(comp.start, comp.end, replacement)`, exactly one chunk spans that range and it is edited with non-empty content. A nested child Component's `start` lies strictly inside that range, so `byStart`/`byEnd` miss, `_chunkAt`/`_split` walk to the edited chunk (`contains(child.start)` is true because `comp.start <= child.start < comp.end`), and `_splitChunk` throws. I also confirmed the walk reaches the child: `next()` is called at L433 after both the clientOnly overwrite (L260) and the server overwrite (L347), and zimmerframe's `next()` descends into `comp.fragment.nodes`, where the `Component` visitor fires again. The plain-`mochi:hydrate` branch is immune because `hasRealChildren` pushes a `hydrate-children` error and returns before any overwrite (L351-356), but `mochi:defer` and `mochi:clientOnly` treat children as fallback, so the nesting is reachable there. Nothing catches it: `cachedPreprocessHydratable` has no try/catch, so the throw escapes the `.svelte` onLoad and compileAll surfaces it as `Svelte SSR build failed: ... cannot split a chunk that has already been edited`, bypassing the `PreprocessIslandError` channel whose doc comment (L36-41) explains island problems are pushed to `errors` rather than thrown. The comment at L232-233 asserts nested islands 'stay untransformed', which is not what happens, and svelteAstPreprocess.test.ts has no directive-carrying-child case (only plain `<div>` children and the hydrate-children error path), so the behaviour was assumed, never verified. Diagnostics-quality bug, not security: BUG is correct.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-13)
