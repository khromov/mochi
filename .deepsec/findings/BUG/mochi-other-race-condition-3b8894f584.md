# [BUG] `markStale` read-modify-write can silently revert a concurrently written value

**File:** [`packages/mochi/src/cache/cache.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/cache/cache.ts#L238-L258) (lines 238, 240, 243, 251, 256, 258)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** low  •  **Slug:** `other-race-condition`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`markStale` reads the entry (L243), computes a backdated copy from the value it read, and writes it back (L258). `supersedeRuns(key)` at L240 only stops a recompute that has not yet cleared its write guard; it cannot stop a writer that is already inside `storage.setItem`, nor an explicit `set()` call. Any write that lands between L243 and L258 is therefore lost — `markStale` overwrites it with the older value it captured earlier, and stamps it `now - minTimeToStale` so the entry is also marked stale.

The method's contract says "an entry can only move staler" (L236), which holds for the timestamp but not for the value: the stored value can move *backwards* a full generation. Concretely, an app that follows the documented guidance at L207-218 — prefer `set()` over `delete` + `fetch` for an atomic replace — can have that `set()` silently reverted by a `markStale` that was already in flight, and will then serve the superseded value (marked stale) until the next revalidation. With `FileStorage` + `offloadBinary` the reverted pointer still resolves, because superseded blobs are intentionally retained, so the regression is invisible rather than erroring.

Self-healing on the next read, and the window is narrow — `markStale` returns early for an entry that is already at-or-past stale age (L253-255), so the losing writer must land inside the gap while the entry is still fresh. I rate confidence low for that reason, but the unguarded read-modify-write is real and `ImageCache.getVariant` calls `markStale` on a hot request path (imageCache.ts:248-250).

## Recommendation

Re-validate under the same guard the recompute path uses: capture the generation before the read and skip the write if `this.generations.get(key)?.generation` changed, or re-read the entry immediately before `setItem` and recompute the backdated timestamp from the value actually present (bailing if it is already at-or-past stale age). Alternatively expose a backend-level compare-and-set for the timestamp so the operation does not round-trip the value at all.

## Revalidation

**Verdict:** true-positive

The structural defect is unambiguous: `markStale` reads the entry at L243, derives `next` from the value it captured, and writes it back at L258 with no re-validation in between; `supersedeRuns` at L240 only clears the in-flight slot and bumps the generation, which stops a run that has not yet reached its sync guard but cannot stop `set()` (which consults no generation and writes unconditionally at L224) nor a run already inside `storage.setItem`. Any write landing in that gap is therefore reverted to the older value *and* backdated, so the stored value moves backwards a generation even though the L236 contract only promises the timestamp can 'only move staler'. Commit 9b7c65c2 fixed the mirror-image race (an unregistered fetch clobbering an invalidator) and its message explicitly scopes out 'a fetch whose own write was already issued to the backend', so this direction is genuinely unaddressed. Where I disagree with the finding is its reachability claim: `ImageCache.getVariant` does call `markStale` on a hot path (imageCache.ts:248-250), but I traced it and it cannot lose a regen's write, because markStale only fires when `existing.status === 'fresh'` and a key with an in-flight run is by definition stale/expired/absent — in which case markStale's own early return at L253-255 (or the null check at L248) makes it a no-op. ImageCache's key spaces are also disjoint: `set` is used only on `phKey` (setPlaceholder, L468), while `markStale` only ever targets `varKey`/`origKey`, and placeholders are never `fetch`ed. So there is no in-tree trigger. The concrete trigger is at the public API: `markStale` is documented (packages/docs/145-cache.md:96,101) alongside the guidance at cache.ts:207-218 to prefer `set()` for an atomic replace, and an app issuing `set(k, v)` concurrently with `markStale(k)` on a fresh entry silently loses the `set`. With `FileStorage` + `offloadBinary` the reverted pointer still resolves (superseded blobs are intentionally retained, per F2), so the regression is invisible rather than erroring. Narrow and self-healing on the next revalidation, which is why BUG rather than anything higher — but the unguarded read-modify-write is real.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-06)
