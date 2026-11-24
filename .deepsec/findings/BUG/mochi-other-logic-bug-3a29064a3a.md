# [BUG] A CSS URL is marked loaded before the stylesheet loads, so one transient failure permanently unstyles every other island sharing it

**File:** [`packages/mochi/src/web-components/sharedCssTracker.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/web-components/sharedCssTracker.ts#L13-L9) (lines 13, 14, 15, 9)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The tracker's contract is "present in the pool == this stylesheet is loaded", but its only writer marks optimistically. HydratableIsland.ts:94-104 does:

  if (cssUrl && !isLoadedCss(cssUrl)) {
    markLoadedCss(cssUrl);           // marked first
    await new Promise((resolve, reject) => { ... link.onerror = () => reject(...) });
  }

If the <link> fires `error` (flaky network, CDN 5xx, a cache-busted hash briefly missing after a deploy), the URL stays in the shared pool forever while the stylesheet was never applied. Failure scenario: a page has three `mochi:hydrate:visible` islands compiled into the same deferred chunk, so all three carry the same `css-url`. Island A scrolls into view first, marks the URL, and its <link> 404s. A's promise rejects, `_doHydrateInner` throws, `_doHydrate`'s catch inserts the failure stub — and because `_hydrated = true` was set at HydratableIsland.ts:54 before the attempt, A never retries, so that component is dead for the rest of the page's life (silently, since production CSS hides `mochi-island-failure`). Islands B and C then hit `isLoadedCss(cssUrl) === true`, skip the load entirely, and hydrate fully interactive but completely unstyled. The dead <link> element is also left in document.head.

ServerIsland.ts:175-181 has the same shape against the same pool (`_css.add(cssUrl)` then append the <link> fire-and-forget, with no onerror at all), so a server island whose CSS 404s also poisons the pool for later hydratable islands.

A secondary, milder effect of the same design: because the mark is not a promise, a second island that arrives while the first load is still in flight skips the await and hydrates before its styles exist, producing a flash of unstyled island.

## Recommendation

Make the pool hold the in-flight promise rather than a bare flag — e.g. `loadCss(url): Promise<void>` memoizing `Map<string, Promise<void>>`, deleting the entry on rejection so a later island retries, and awaiting the shared promise so concurrent callers hydrate only after the stylesheet is applied. Keep the <link> removal on error. Fold ServerIsland.ts:175-181 into the same helper instead of re-implementing the global-Set access inline, and consider whether a CSS load failure should really abort hydration at all (degrading to unstyled-but-interactive may be preferable to a permanently dead island).

## Revalidation

**Verdict:** true-positive

Confirmed by reading the whole path. The tracker's contract is 'in the pool means loaded' (sharedCssTracker.ts:9-15), but HydratableIsland.ts:94-104 calls `markLoadedCss(cssUrl)` *before* awaiting the `<link>`, and the `onerror` branch rejects (101) without removing the URL from the pool or the element from `document.head`. The rejection propagates out of `_doHydrateInner`, is caught by `_doHydrate` (58-65), and because `_hydrated = true` was set at line 54 before the attempt, `connectedCallback`'s guard at 35 means that island is never retried — permanently non-interactive, with the appended `mochi-island-failure` stub `display:none` in production (islandFailureStub.ts:5). Meanwhile sibling islands see `isLoadedCss(cssUrl) === true`, skip the load entirely, and hydrate fully interactive but unstyled. The shared-URL precondition is real: `css-url` is `__MOCHI_CSS_URL__<islandKey>__` (svelteAstPreprocess.ts:251, 386) resolved from `cssFileUrls.get(h.resolvedPath)` (ComponentRegistry.ts:1723-1730), so every instance of the same `mochi:hydrate:visible`/`mochi:clientOnly:visible` component on a page carries an identical URL. ServerIsland.ts:174-181 re-implements the same optimistic mark against the same global pool with no `onerror` at all, so a server island whose CSS 404s poisons the pool for later hydratable islands too. The secondary FOUC effect is also real, since a flag rather than a promise means a concurrent island skips the await while the stylesheet is still in flight. I'm adjusting severity from BUG to BUG unchanged in substance — this is a correctness/robustness defect with no security impact, triggered by a transient CSS failure rather than by an attacker; the memoized-promise fix in the recommendation is the right shape.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-17)
