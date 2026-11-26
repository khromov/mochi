# [BUG] Client-side DeferReloadState instances and their event subscriptions are never released

**File:** [`packages/mochi/src/islands/deferReloadState.svelte.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/islands/deferReloadState.svelte.ts#L20-L50) (lines 20, 29, 33, 38, 44, 45, 46, 47, 48, 49, 50)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-resource-leak`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

Every `DeferReloadState` subscribes to the global mitt emitter for its name and discards the returned unsubscribe function (L20, and `subscribeDeferredIsland` at deferInvalidation.ts:40-43 returns an off() that is never called). To stop that leaking per read, instances are memoised in a `globalThis`-pinned map (L33, L44-50) — which bounds the leak per *name*, not absolutely.

With dynamic names the growth is unbounded for the page's lifetime: a list of per-row reloadable islands (`deferReloadState(`row-${id}`)`), a name derived from a route param, or a filter/search key each add one permanently-retained state object plus one permanently-registered listener, with no eviction path even after the corresponding `<mochi-server-island>` unmounts and `unregisterDeferredIsland` has cleared the island registry for that name. `notifyDeferredIslandChange` then snapshots an ever-growing handler list on every reload round.

The pinning is deliberate per the L37 comment, but it trades a per-read leak for an unbounded per-name one rather than eliminating it.

## Recommendation

Keep the unsubscribe handle and release it when the last island for a name unregisters — e.g. have `unregisterDeferredIsland` emit a terminal change that lets the cached state tear itself down and delete its map entry — or store instances in a structure that can be reclaimed (keyed off the island element rather than the bare name) so a page with dynamic names does not accumulate state objects and listeners indefinitely.

## Revalidation

**Verdict:** true-positive

Verified in both files. `DeferReloadState`'s constructor calls `subscribeDeferredIsland(name, cb)` and drops the returned unsubscriber (deferReloadState.svelte.ts:20), and `subscribeDeferredIsland` genuinely returns a working `off()` that nobody ever calls (deferInvalidation.ts:40-43). The instance cache is pinned with `pinGlobal`, which is a plain strong reference on `globalThis` with no eviction and no weak semantics (utils/globalState.ts:5-9), so each distinct name permanently retains one state object plus one registered mitt handler for the page's lifetime. The teardown path that does exist is for a different registry: `unregisterDeferredIsland` removes the element from `__mochi_deferred_islands__` and deletes the name key when empty (deferInvalidation.ts:49-59), but it never touches `__mochi_defer_reload_states__` or the listener emitter — so after a `<mochi-server-island>` unmounts, its state object and listener survive. Growth is driven by legitimate, documented usage rather than misuse: the docs tell users to name islands, and per-row reloadable islands (`deferReloadState(`row-${id}`)`) or a name derived from a client-side filter/search key each add a permanent entry, which for a long-lived page with virtualised or infinitely-scrolled rows accumulates without bound. The L37 comment is honest that per-read instances would leak worse, but memoising by name trades a per-read leak for an unbounded per-name one rather than removing it. Practical impact is modest — a small object and a closure per distinct name, reset by any full navigation — so BUG is the right severity, and keying the cache off the island element, or tearing down on last unregister, is the fix.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-19)
