# [BUG] A failed deferred-CSS load aborts hydration entirely and permanently marks the stylesheet as loaded

**File:** [`packages/mochi/src/web-components/HydratableIsland.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/web-components/HydratableIsland.ts#L94-L101) (lines 94, 95, 101)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

For a lazy island, `_doHydrateInner` awaits a promise that rejects on `link.onerror` (L94-104). That rejection propagates out of `_doHydrateInner`, is caught by `_doHydrate`'s belt (L58-65), and the island is finished: `_hydrated` was already set to `true` at L54, so there is no retry, and the only trace is a `logger.error` plus an `<mochi-island-failure>` stub that `ISLAND_FAILURE_CSS` renders `display: none` in production (islandFailureStub.ts:4-6). A transient failure on a *presentational* asset — a flaky network, a CDN hiccup, an ad blocker, a 404 from a stale hashed CSS URL after a deploy — therefore silently kills the island's interactivity, even though the component JS and props were fine. This is a notable asymmetry with `ServerIsland`, which fire-and-forgets the same `<link>` injection (ServerIsland.ts:175-181) and retries its fetch up to ten times.

Second defect in the same block: `markLoadedCss(cssUrl)` runs at L95, *before* the load resolves. The URL is recorded as loaded even when the load fails, so every other island on the page sharing that stylesheet takes the `isLoadedCss` short-circuit, skips injection entirely, and hydrates permanently unstyled with no error of its own. The eager marking also means a second island with the same `cssUrl` proceeds to hydrate without waiting for the stylesheet that is still in flight, producing a flash of unstyled island content.

## Recommendation

Do not let a stylesheet failure abort hydration — resolve on `onerror` (logging a warning) instead of rejecting, so the island still hydrates and is merely unstyled. Move `markLoadedCss(cssUrl)` into the `onload` path, or un-mark it on error, so a failed load does not suppress the injection for sibling islands; if eager marking is kept for dedup, cache the in-flight promise per URL so concurrent islands await the same load rather than racing past it.

## Revalidation

**Verdict:** true-positive

Both halves of this finding follow directly from the code, and I traced every link. (1) `_doHydrate` sets `this._hydrated = true` at L54 *before* entering the try, then awaits `_doHydrateInner`, whose L94-104 block awaits a promise that `reject`s on `link.onerror`. The rejection unwinds to the L58-65 catch, which only logs and appends `islandFailureStub(...)`; nothing resets `_hydrated` and nothing re-enters `_doHydrate` for a page island (the only caller is `connectedCallback`, and the visible-path observer already self-unobserved at sharedVisibilityObserver.ts:35 before invoking the callback). So a stylesheet failure is terminal: component JS and props were never even requested (the `import()` is at L107-110, after the CSS await), yet the island stays non-interactive. In production the stub is invisible — `ISLAND_FAILURE_CSS` sets `mochi-island-failure { display: none }` unconditionally and the dev rule keys on `[data-message]`, which is omitted when `isDev` is false (islandFailureStub.ts:37-43) — so the user just gets dead SSR markup. The asymmetry with `ServerIsland` is real: that element fire-and-forgets the identical `<link>` injection with no onload/onerror at all (ServerIsland.ts:174-181) while retrying its fetch 10 times (L156/L159). (2) The eager `markLoadedCss(cssUrl)` at L95 is also genuinely wrong on the failure path. The tracker is a process-wide `Set` shared across both inline bundles (sharedCssTracker.ts + the raw `__mochi_loaded_css__` global in ServerIsland.ts:9), and the `css-url` attribute is per-component-path (`__MOCHI_CSS_URL__<islandKey>__` → `cssFileUrls.get(resolvedPath)`, ComponentRegistry.ts:1723-1730), so two instances of the same lazy component — e.g. `{#each items}<Card mochi:hydrate:visible />{/each}` — share one URL. The second instance sees `isLoadedCss` true, skips the block entirely, and hydrates immediately: unstyled if the load failed, FOUC if it is still in flight. This matters because ComponentRegistry.ts:1875-1877 deliberately excludes lazy-island CSS from the page shell (`lazyIslandPaths` → `continue`), so that deferred `<link>` is the island's only stylesheet. Triggers are mundane (flaky network on the stylesheet request, a 404 from a stale hashed URL, any load that fails while the JS would have succeeded), and the maintainers already treat exactly this class of problem as a shipped bug — commit 77b76bc8 fixed 'a plain 404 on the island bundle turned a fully rendered post list and navbar into a blank.' Not fixed in HEAD; the CSS block is untouched by that commit. BUG severity is right.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-02)
