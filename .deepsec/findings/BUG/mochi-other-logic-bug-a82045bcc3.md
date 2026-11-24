# [BUG] fetchItem memoizes upstream failures as "item not found" for up to 10 minutes

**File:** [`packages/demos/src/hn/hn-api.ts`](https://github.com/khromov/mochi/blob/main/packages/demos/src/hn/hn-api.ts#L39-L42) (lines 39, 40, 41, 42)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The `!res.ok` branch sits *inside* the `itemCache.fetch` callback and returns `null`. `MochiCache.run` stores whatever the callback resolves to, wrapped as `{ value, createdAt }` (cache.ts:365), and `lookup` only treats a *missing* entry as a miss (`if (entry == null)`, cache.ts:141) — a stored `value: null` is a legitimate cache hit. So a transient upstream 429/503 is written into the cache and served as 'Item not found' for `minTimeToStale` (60s) before any revalidation is even attempted, and can keep being served stale for up to `maxTimeToLive` (10 min) while background revalidation runs.

This conflates two genuinely different states — HN legitimately returns `200` with a JSON `null` body for unknown ids, which *should* be cached, versus a transport/status failure, which should not be.

Relatedly, all three helpers return `res.json()` cast directly to their declared types with no runtime validation. `fetchStories` then calls `ids.slice(...)` on the result (L66), which throws a `TypeError` if the upstream ever answers with a non-array (e.g. an error object), producing a 500 on the front page rather than a degraded render.

## Recommendation

Throw on `!res.ok` so the error propagates instead of being memoized (`MochiCache` does not store a rejected run), and keep caching only the genuine `200 + null` 'does not exist' answer. Add a shape check (`Array.isArray(ids)`) before `slice` in `fetchStories`.

## Revalidation

**Verdict:** true-positive

Traced through the cache implementation and confirmed exactly. `fetchItem`'s `!res.ok -> return null` sits inside the `itemCache.fetch` callback, and `MochiCache.run` persists whatever `fn()` resolves to by writing `this.serialize({ value, createdAt: this.now() })`, where `serialize` defaults to `identity` (cache.ts:~113). `MemoryStorage.setItem` then stores `{ value: {value: null, createdAt}, writtenAt }`, so `getItem` returns a truthy object, `read()`'s `raw == null ? null : …` yields a non-null entry, and `lookup`'s only miss test is `if (entry == null)` (cache.ts:141) — a stored `value: null` is a bona fide cache hit. The timing claims hold too: `age < minTimeToStale` (60s) returns 'fresh' with no revalidation attempted at all, and between 60s and `maxTimeToLive` (600s) the stale null is served while a background `run` refreshes. The recommendation is sound because `run` reaches `storage.setItem` only after `await fn()` resolves, so a thrown error is genuinely never memoized. The conflation identified is real: Firebase answers 200 + JSON `null` for an unknown id, which should be cached, and this code makes a transient 429/503 indistinguishable from it. One small imprecision to note: a transport-level failure (a rejected `fetch`) already propagates and is not cached, so only HTTP-status failures get memoized. The secondary claim also holds — `fetchStoryIds` casts `res.json()` with no shape check, so a 200 plus a non-array body (including JSON `null`) makes `fetchStories`' `ids.slice` throw a TypeError into a 500 at hn-api.ts:66.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-06)
