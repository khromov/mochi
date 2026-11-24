# [BUG] No unobserve path: detached islands that never intersected are retained for the page lifetime, unbounded across server-island reloads

**File:** [`packages/mochi/src/web-components/sharedVisibilityObserver.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/web-components/sharedVisibilityObserver.ts#L21-L8) (lines 21, 48, 49, 8)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-resource-leak`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`observeVisible` is the module's only export — there is no `unobserveVisible`, and nothing in web-components/ or islands/ ever calls `unobserve` or `disconnect` on the pooled observer (the only cleanup is the self-unobserve at line 35, which runs solely when the element actually intersects). The file's own comment at lines 8-12 acknowledges the detached-node retention and concludes it is "bounded by page lifetime, so not a real leak" — that reasoning does not hold once a subtree can be replaced repeatedly.

Failure scenario: a `mochi:defer` island named for reload (public API `reloadDeferredIsland`, islands/deferInvalidation.ts:61) whose rendered content includes a `mochi:hydrate:visible` child below the fold. Each reload runs `this.innerHTML = html` (ServerIsland.ts:187), detaching the previous subtree. `_unmountChildren` (ServerIsland.ts:71-79) deliberately handles the Svelte-root leak, but for an island that never hydrated `_unmount` is undefined and nothing touches the visibility observer. The pooled IntersectionObserver still holds a strong reference to the old `target`; because the key is strongly reachable, the WeakMap entry at line 48 stays live and keeps the `() => this._doHydrate()` closure, which captures the island element and therefore its whole detached DOM subtree. A dashboard that reloads such an island on an interval (a documented pattern) leaks one full subtree per reload, growing without bound, and grows the observer's observed-target list on every round.

The retained element can never intersect, so the self-cleanup at lines 35-37 is unreachable for exactly the elements that leak.

## Recommendation

Export an `unobserveVisible(target)` that calls `entry.observer.unobserve(target)` and `entry.callbacks.delete(target)` across every pool entry, and call it from ServerIsland's `_unmountChildren` for each `mochi-hydratable-island` in the discarded subtree (reading the element's recorded target, or iterating pool entries). Alternatively hold the callback behind a `WeakRef` and have the observer skip-and-unobserve a target whose `isConnected` is false, so stale observations self-reap on the next notification.

## Revalidation

**Verdict:** true-positive

I verified every step of the retention chain. `observeVisible` is the module's sole export and its sole caller is HydratableIsland.ts:43; a repo-wide grep for `unobserve`/`disconnect` finds only the self-unobserve at sharedVisibilityObserver.ts:35 (reached solely when `e.isIntersecting` is true) plus unrelated observers in MochiCaptcha and IslandsPanel. There is no `unobserveVisible`, and the pooled observer is pinned in a `globalThis` Map (`pinGlobal('__mochi_visibility_pool__')`) for the realm's lifetime, so it is permanently strongly reachable — and it in turn strongly holds every observation target (the file's own comment at L8-12 concedes this). Because the observed node is `this.firstElementChild || this`, its parent pointers retain the whole detached subtree, and the WeakMap entry at L48 stays live since its key is strongly reachable. The churn mechanism the comment assumed away exists: `ServerIsland._reload` → `_fetchContent` assigns `this.innerHTML = html` (ServerIsland.ts:187) after `_unmountChildren` (L71-79), which only bumps `_generation` and calls `_unmount?.()` — undefined for an island that never hydrated — and never touches the observer. So a named `mochi:defer` island (public, documented API: `reloadDeferredIsland`, deferInvalidation.ts:61, docs/70-server-islands.md:70-139) whose rendered content includes a below-the-fold `mochi:hydrate:visible` child leaks one full detached subtree per reload and adds one more permanent observation target each time. The nesting shape is supported and documented ('A server island's content is a full render, so it can contain mochi:hydrate islands'), the endpoint ships the bootstrap that defines the element (Mochi.ts:1684-1687), and the preprocessor's nested-hydration guard (ComponentRegistry.ts:957-979) only blocks hydratables inside *hydratable* subtrees, not inside server islands. The finding's final observation is also correct and is what makes it unbounded: a detached target computes an empty intersection rect, so `isIntersecting` is never true and the L35-37 cleanup is unreachable for exactly the elements that leak. Supporting evidence that the assumption was never revisited: sharedVisibilityObserver.ts was last touched in f7bcd712 (#158), while `reloadDeferredIsland` landed later in 67bc3152 (#312) — the comment even says 'revisit if islands churn faster than expected.' Narrow preconditions keep this at BUG rather than higher.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-17)
