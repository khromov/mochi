# [MEDIUM] Unbounded attacker-controlled cache keys on an unauthenticated, unrate-limited route grow a never-evicting in-memory Map and fan out to a third-party API

**File:** [`packages/site/src/demos/data-loading/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/data-loading/routes.ts#L6) (lines 6)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-unbounded-cache-growth`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`/demos/data-loading/:id` has no `rateLimit` option, and `packages/site/src/index.ts` sets no global `rateLimit` on `Mochi.serve()`, so this route is reachable by anyone at any rate. Each distinct `:id` value does two unbounded things in `DataLoading.svelte`:

1. **Permanent memory.** `pokemonCache.fetch(`pokemon:${id}`, ...)` writes one entry per distinct `id`. `pokemonCache` (`src/lib/cache.ts`) constructs `new MochiCache({...})` with no `storage` override, so it gets `new MemoryStorage()` with neither `maxAge` nor `purgeInterval` — whose own docstring states it "holds everything forever. Pass `maxAge` so `sweep()` reclaims aged-out entries — the only way to bound the footprint" (cache-storage.ts:88-91). `MochiCache` itself never deletes: past `maxTimeToLive` `lookup` recomputes and *overwrites* the key, it does not evict it. So the backing `Map` grows monotonically with every unique path segment ever requested. The id is neither validated nor length-bounded (`(params.id ?? 'pikachu').toLowerCase()`), so each request can plant a multi-kilobyte key; a few hundred thousand requests is enough to exhaust a typical container memory limit and get the process OOM-killed. The only brake is the OS low-memory signal (`registerPressureResponder`), and it is a weak one: `MemoryStorage.sweep()` returns `{removed: 0}` unconditionally when `maxAge` is undefined (cache-storage.ts:132-135), so `'warning'`-level pressure reclaims nothing from this cache — only `'critical'` clears it, and a cgroup OOM-kill frequently arrives without any userspace notification.

2. **Outbound fan-out.** Every miss issues a live request to `https://pokeapi.co/api/v2/pokemon/<id>` — a free third-party API with a fair-use policy. Since every unique id is a guaranteed miss, an attacker converts cheap inbound requests into unbounded outbound traffic to a third party under the site's IP, risking throttling or an IP ban that breaks the demo for real users. The host is hardcoded and `encodeURIComponent(id)` is applied, so this is abuse/amplification, not SSRF — `%2F` is not decoded during URL path normalization and `encodeURIComponent` escapes `%`, so no traversal to other API paths is possible.

## Recommendation

Validate `:id` before it reaches the cache or the network — reject anything not matching a tight pattern (`/^[a-z0-9-]{1,32}$/`) or, best, anything not present in the already-fetched 151-entry option list, returning 404 early. Add a `rateLimit` to the route (`Mochi.page(..., { rateLimit: { limit: 60, window: '1m' } })`), matching what `demos/charts`, `demos/queue` and `demos/captcha` already do. Bound the backend regardless of validation: `new MochiCache({ storage: new MemoryStorage({ maxAge: 86_400_000, purgeInterval: 600_000 }), ... })` so the footprint cannot grow without limit even with a valid-looking key space.

## Revalidation

**Verdict:** true-positive

Confirmed in full. `/demos/data-loading/:id` passes no `rateLimit` to `Mochi.page` (which does accept one, Mochi.ts:207-220) and `packages/site/src/index.ts` sets no server-wide `rateLimit`, so `routeLimiters.get(pattern)` is null and `checkRouteLimit` returns `{}` immediately (Mochi.ts:862-865). `pokemonCache` (site/src/lib/cache.ts) passes only `minTimeToStale`/`maxTimeToLive`, so `MochiCache` falls back to `new MemoryStorage()` (cache.ts:110) with neither `maxAge` nor `purgeInterval` — whose own docstring (cache-storage.ts:88-91) says it 'holds everything forever'. `MochiCache` never deletes on the read path: past `maxTimeToLive`, `lookup` recomputes and `run` *overwrites* the key via `setItem`, it never evicts. `id` is unvalidated and unbounded, and every distinct value is a guaranteed miss that writes a new Map entry (a 404 stores `{value: null}`), so the backing Map grows monotonically with the attacker-chosen key space — only `generations` is reclaimed (cache.ts:305-321), not `store`. The memory-pressure escape hatch is as weak as described: `respondToPressure` (memoryPressure.ts:69-80) calls `sweep()` on `'warning'`, and `MemoryStorage.sweep()` returns `{removed: 0}` unconditionally when `maxAge` is undefined (cache-storage.ts:132-135); only `'critical'` clears, and a cgroup OOM kill commonly arrives with no userspace signal. The outbound half is real too — every unique id issues a live request to a free third-party API under the site's IP. The SSRF caveat is correctly dismissed: the host is hardcoded and `encodeURIComponent` escapes `/` and `%`, so no traversal to other pokeapi paths. Sibling demos already demonstrate the fix (`charts/routes.ts:30`, `queue/routes.ts:13`, `rate-limit/routes.ts:11`), so the omission is an inconsistency rather than a site-wide convention. MEDIUM is appropriate for unbounded attacker-keyed memory growth on an unauthenticated, unlimited route of a deployed site.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
