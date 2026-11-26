# [HIGH_BUG] Island props ref ids are not namespaced per render, so a page island can hydrate with a server-island fragment's props

**File:** [`packages/mochi/src/islands/islandPropsRegistry.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/islands/islandPropsRegistry.ts#L47-L89) (lines 47, 70, 89)
**Project:** mochi
**Severity:** HIGH_BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`emitIslandProps` mints ref ids purely from the per-render map size: `mochi-props-${ctx.islandProps.size}` (L47). Every render restarts at 0 — the host page render, and each server-island fragment render at `/_mochi/island/:name` (which gets a fresh request context, so a fresh empty `islandProps` map). `injectIslandPropsBlock` then writes those ids as global DOM ids (L70, L89), and fragments are spliced into the live page via `this.innerHTML = html` in `ServerIsland.ts:187`, so the document ends up with several elements sharing `id="mochi-props-0"`.

`resolveIslandProps` (packages/mochi/src/web-components/resolveIslandProps.ts:11-13) handles only one direction of this collision: an island *inside* a `<mochi-server-island>` is scoped via `closest()`. A page-level island has no such ancestor, so it falls through to `document.getElementById(propsRef)`, which returns the **first** matching element in document order. If a `mochi:defer` wrapper sits earlier in the page than the island, the fragment's injected block precedes the page's own block and wins.

The existing unit test (resolveIslandProps.test.ts:21-33) asserts the page island still resolves `'PAGE'` — but only because that fixture places the page block *before* the `<mochi-server-island>`. Reverse the order and the same code returns the fragment's payload.

Failure requires the page island to resolve its props after the fragment lands, which is precisely what `mochi:hydrate:visible` does: `HydratableIsland.connectedCallback` defers `_doHydrate()` to an IntersectionObserver callback (HydratableIsland.ts:38-43), and `resolveIslandProps` runs inside it (L75-78). Anything below the fold resolves long after an above-the-fold `mochi:defer` fetch has completed. The shipped pattern is live in the repo: `packages/site/src/demos/nested-islands/DeferWithHydrators.svelte:15-17` puts three `mochi:hydrate` Counters inside a `mochi:defer` island at the top of the page, producing fragment ids `mochi-props-0..2`.

Result: the island hydrates with another component's props — a devalue payload that parses fine but carries foreign keys, so the component either renders wrong data (one island's server-side data surfacing inside an unrelated component) or throws a hydration mismatch into its boundary and degrades to the failure stub.

## Recommendation

Namespace the ref id per render rather than relying on lookup scoping. The island endpoint already derives an `idPrefix` from the wrapper's island id for `$props.id()` (Mochi.ts:1620-1622) — thread the same prefix into `emitIslandProps` so fragment ids become e.g. `mochi-props-<islandId>-0`. Failing that, make `resolveIslandProps` resolve strictly against the island's own preceding sibling instead of falling back to a document-wide `getElementById`, and add a regression test with the server island placed before the page island.

## Revalidation

**Verdict:** true-positive

I confirmed every link in the chain. `emitIslandProps` mints `mochi-props-${ctx.islandProps.size}` (islandPropsRegistry.ts:47) and `renderComponent` calls `ctx?.islandProps.clear()` at the start of every render (ComponentRegistry.ts:1704), so the counter restarts at 0 for the page render *and* for each `/_mochi/island/:name` render — the endpoint runs the identical `renderComponent` path (Mochi.ts:1620) inside its own fresh `ctx` with a fresh `islandProps` Map (requestSetup.ts:146). The island endpoint's fragment therefore contains its own `<script id="mochi-props-0">` blocks whenever the deferred component holds nested `mochi:hydrate*` children (`hasIslandsOrServerIslands` is true, so `injectIslandPropsBlock` runs), and `ServerIsland.ts:187` splices that HTML into the live document inside the `<mochi-server-island>` element. `resolveIslandProps` scopes only the inside-out direction via `closest('mochi-server-island')`; a page island gets `null` there and falls through to `document.getElementById`, which per spec returns the first element in *tree order*. Since `injectIslandPropsBlock` places a block immediately before the first island referencing it (L89), a page shaped `<Widget mochi:defer/>` … `<Chart mochi:hydrate:visible data={…}/>` puts the page's `mochi-props-0` block *after* the `<mochi-server-island>`, so once the fragment lands its `mochi-props-0` wins the document-wide lookup. Timing is satisfied deterministically for `:visible` islands: `connectedCallback` hands `_doHydrate` to an IntersectionObserver (HydratableIsland.ts:38-43) and `resolveIslandProps` runs inside it (L78), so a below-the-fold island resolves long after an above-the-fold defer fetch completed. The window is actually wider than the finding states — `serverIslandClientJs` is emitted as an inline classic script while the hydration bootstrap is a deferred `type="module"` (Mochi.ts:324/367), so the defer fetch starts during parsing while even eager page islands upgrade only after parsing, giving the same collision on a slow bootstrap. Commit ea1c97bd fixed exactly the mirror-image case and asserted 'page islands … unaffected', and its test fixture only passes because it places the page block before the server island (resolveIslandProps.test.ts:22-32) — reverse the order and the same code returns the fragment payload. Result is a silent wrong-props hydration (foreign keys parse fine via devalue) or a hydration throw into the boundary; HIGH_BUG is appropriate for silent data corruption, and the fix should namespace the emit id rather than patch the lookup again.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-09)
