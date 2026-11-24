# [HIGH_BUG] Island props resolved by tree order across independent renders — a page island can hydrate with a server island's props

**File:** [`packages/mochi/src/web-components/resolveIslandProps.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/web-components/resolveIslandProps.ts#L11-L12) (lines 11, 12)
**Project:** mochi
**Severity:** HIGH_BUG  •  **Confidence:** high  •  **Slug:** `other-cross-render-props-confusion`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`resolveIslandProps` locates a hydratable island's props payload with `scope?.querySelector('#'+CSS.escape(ref)) ?? document.getElementById(ref)`. Two defects combine:

1. `scope?.querySelector(...)` returns `null` on a *miss*, not just when there is no scope, so the `??` falls through to the document-wide lookup whenever the enclosing `<mochi-server-island>` subtree does not contain the ref — exactly the cross-render leak the function's own doc comment says it prevents.
2. For an ordinary page island (`closest()` is `null`) the only lookup is `document.getElementById(ref)`, which the DOM spec defines as "the first element, in tree order" — not "the block my render emitted".

The id space guarantees collisions. `emitIslandProps` (islandPropsRegistry.ts:47) numbers ids `mochi-props-${ctx.islandProps.size}`, and `renderComponent` clears `ctx.islandProps` per render (ComponentRegistry.ts:1704). The server-island endpoint runs the same `renderComponent` + `injectIslandPropsBlock` pass on a fresh `islandProps: new Map()` (requestSetup.ts:146), so every island fragment restarts at `mochi-props-0`. `ServerIsland._fetchContent` then splices that fragment — props `<script>` blocks included — into the live document via `this.innerHTML = html` (ServerIsland.ts:187).

Deterministic failure: a page with a `mochi:defer` server island positioned above a below-the-fold `mochi:hydrate:visible` (or `mochi:clientOnly:visible`) island that carries props. The page's block for that island is injected immediately before it (islandPropsRegistry.ts:89), i.e. *below* the server-island wrapper. The island fragment lands within one round trip; the visible island reads its props only on intersection (HydratableIsland.ts:75-81, reached from the IntersectionObserver callback). By then `document.getElementById('mochi-props-0')` returns the server island's block, which is earlier in tree order. The page island is handed the nested island's props.

The same confusion hits eager islands as a race: the inline `ServerIsland` script is a classic `<script>` that upgrades wrappers and starts fetching during parse (Mochi.ts:324,368), while `mochi-hydratable-island` is only defined once the deferred `<script type="module" src=bootstrapUrl>` downloads and runs (Mochi.ts:367) — so a slow bootstrap lets the fragment win. It also recurs on every `reloadDeferredIsland()` round, and in the nested direction: `scope.querySelector('#id')` searches the whole subtree, so a loaded inner `<mochi-server-island>` positioned before the outer island's own block shadows it too.

Outcome is either a hard failure (devalue throws at HydratableIsland.ts:123, the island is replaced by a `display:none` failure stub in production and is silently never interactive) or, when the two payloads happen to be shape-compatible, a silent hydration with another component's data.

## Recommendation

Make the props id globally unique instead of resolving by tree order. Namespace server-island renders — e.g. have `emitIslandProps` prefix ids with the render's `islandId` (already threaded into `renderComponent` as `idPrefix` at Mochi.ts:1622), so a fragment emits `mochi-props-<islandId>-0`. Until then, fix the lookup so the fallback is scope-conditional rather than miss-conditional (`const block = scope ? scope.querySelector(...) : document.getElementById(ref)`) and, for the page path, exclude `mochi-server-island` subtrees (walk `document.querySelectorAll('#'+CSS.escape(ref))` and pick the first whose `closest('mochi-server-island')` is `null`). Add a regression test with the server island placed *before* the page island — the existing resolveIslandProps.test.ts only covers the reverse order, which is why this passes today.

## Revalidation

**Verdict:** true-positive

Every link in the chain checks out. Ids are allocated per render with no namespacing: `emitIslandProps` returns `mochi-props-${ctx.islandProps.size}` (islands/islandPropsRegistry.ts:47), `renderComponent` clears `ctx.islandProps` per render (ComponentRegistry.ts:1704), and the island endpoint runs through `buildRequestContext`, which creates a fresh `islandProps: new Map()` per request (runtime/requestSetup.ts:146) — so an island fragment restarts at `mochi-props-0`. The endpoint calls the same `registry.renderComponent` (Mochi.ts:1620), whose HTMLRewriter pass calls `injectIslandPropsBlock` (ComponentRegistry.ts:1775), and nothing in the endpoint tail (Mochi.ts:1654-1694) strips those blocks; I confirmed `idPrefix` only reaches Svelte's `render()` and never touches props ids. The preprocessor emits `props-ref` for every `mochi:hydrate`/`mochi:hydrate:visible`/`mochi:clientOnly:visible` site with non-empty props (svelteAstPreprocess.ts:240, 382), including nested ones inside a server island, so collisions are guaranteed whenever both renders emit at least one payload. The lookup defect is exactly as described: `scope?.querySelector(...) ?? document.getElementById(ref)` falls through on a *miss* as well as on a null scope, and for a page island (`closest()` null) the only lookup is the document-wide, tree-order one. The commit that introduced this file (ea1c97bd, #340) fixed only the nested→page direction and its test file covers only page-block-first ordering, so the reverse order is untested and unguarded. The in-repo shape is already present: `DemoPage.svelte` renders `<ReadmeCopy mochi:hydrate …>` above the demo children and `<CodeViewer {sources} mochi:hydrate />` below them, while `nested-islands/DeferWithHydrators.svelte` nests three props-carrying `mochi:hydrate` Counters inside a `mochi:defer` island — so CodeViewer's `props-ref` collides with a Counter's block that is earlier in tree order once the fragment lands. Eager islands usually win the race (the bootstrap is a deferred module at Mochi.ts:367 while the inline ServerIsland classic script at 368 starts fetching during parse), but a below-the-fold `mochi:hydrate:visible` island resolves props only in the IntersectionObserver callback (HydratableIsland.ts:43 → 75-78), which is deterministically after the fetch. Outcome is a devalue throw (HydratableIsland.ts:123) leaving a production-hidden `mochi-island-failure` stub appended, or silent hydration with another component's props. HIGH_BUG is appropriate.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-28)
