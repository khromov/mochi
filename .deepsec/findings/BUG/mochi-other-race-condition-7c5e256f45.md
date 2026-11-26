# [BUG] Blob-folder deletion races a concurrent `setItem`, persisting an entry whose pointer dangles

**File:** [`packages/mochi/src/cache/cache-storage.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/cache/cache-storage.ts#L336-L464) (lines 336, 346, 352, 355, 359, 369, 460, 463, 464)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-race-condition`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`setItem` commits blobs first and the JSON last (L336-356), which makes a reader that sees the JSON always see the blobs it points at — but nothing serializes that two-phase write against the two code paths that `rm -rf` the folder: `removeItem` (L369) and sweep pass 1 (L464).

Interleaving that corrupts the entry:
1. Writer: `mkdir <hash>/`, durable-write blob tmp, rename it in — the blob is now in the folder.
2. Deleter: `unlink <hash>.json` (or it was already absent), then `rm(<hash>/, {recursive, force})` — the blob the writer just committed is destroyed.
3. Writer: renames its temp onto `<hash>.json`, which succeeds (a top-level file, untouched by the `rm`).

The result is a *persisted* entry with a fresh mtime and a fresh envelope `createdAt` whose `__mochiBlob` target no longer exists. `getItem` happily returns the `BlobRef` (nothing checks existence), and every consumer then fails: `ImageCache.toBytes` → `readBlobRef` → ENOENT, which `imageEndpoint.ts:160-165` converts to `500 'Image processing failed'`. Because `MochiCache` considers the rewritten entry fresh, no revalidation is attempted for `minTimeToStale` — 4h at the image defaults — so a single lost race poisons one variant into hours of hard 500s rather than a transient blip. It self-heals only once the entry goes stale and a background regen rewrites it.

Reachable from normal traffic, not just from the hourly janitor: `MochiCache.delete` → `storage.removeItem` is called by `ImageCache.getVariant` whenever the shared original is gone or expired (imageCache.ts:240-242) and by `cascadeSource` on hard invalidation (imageCache.ts:388-416), concurrently with other requests regenerating the same variant key. `MochiCache`'s generation/in-flight guard is checked *before* `storage.setItem` is awaited (cache.ts:368-375) and its own doc comment (cache.ts:217-218) scopes that gap to "whichever lands last wins" — correct for a single-file value, but with blob offloading the loser's `rm` can destroy the winner's bytes, which is corruption rather than a stale value.

A milder variant of the same unguarded lifecycle: `getItem` hands out a *lazy* reference, so a sweep or `removeItem` landing between the `getItem` and the caller's `readBlobRef` deletes the file out from under a read that was already in progress (one transient 500). The L545-549 comment reasons only about rewrites ("a rewrite lands in a new file that a live lazy BlobRef can't be reading"); deletion is not covered.

## Recommendation

Make the JSON the sole authority for folder liveness and never delete a folder that a concurrent write may be populating: re-check that `<hash>.json` is still absent (and that the folder's mtime is older than the grace window) immediately before `rm` in both `removeItem` and sweep pass 1, or take a per-key async mutex shared by `setItem` / `removeItem` / the sweep. Independently, make a dangling pointer self-healing rather than sticky — have `getItem` (or `readBlobRef`'s caller) treat a missing blob file as a cache miss so the next request recomputes instead of serving ENOENT for a full `minTimeToStale` window.

## Revalidation

**Verdict:** true-positive

Distinct from F2 (growth vs. corruption) and structurally confirmed. `setItem` is a two-phase commit — blobs renamed in first (L339-348), JSON renamed last (L352-355) — and nothing serializes it against `removeItem`'s unconditional `rm(join(directory, hash), {recursive, force})` (L369) or sweep pass 1's identical `rm` (L464). Both are `async` with multiple awaits, so the interleaving is reachable in a single-threaded event loop: writer renames the blob in, deleter unlinks the (possibly absent) JSON and recursively removes the folder, writer's JSON rename then lands on an untouched top-level path and succeeds. The window is not instantaneous — it spans `fsyncDir(blobDir)` plus a full `writeFileDurable` (open/write/fsync/close) on the JSON temp, i.e. real fsyncs. Importantly, `removeItem` `rm`s the folder even when no JSON existed, so a *first* population racing an unconditional `invalidateOriginal(src, true)` → `cache.delete(origKey)` hits it too. I verified the guard placement: `cache.ts:368` checks inflight identity and generation *synchronously* and then awaits `storage.setItem`, so a `delete` arriving during that await cannot stop the write — and `set()`'s own docstring (L217-218) concedes exactly this gap, while commit 9b7c65c2's message states the fix 'deliberately does not cover a fetch whose own write was already issued to the backend'. The consequence chain is confirmed: `decodeBlobs` never stats the target, so `getItem` hands back a `BlobRef` to a missing file; `ImageCache.toBytes` → `readBlobRef` throws ENOENT, which is not an `ImageError`, so `imageEndpoint.ts`'s catch returns `textResponse(500, 'Image processing failed')`. Because the corrupted JSON carries a fresh envelope `createdAt`, `MochiCache.lookup` reports 'fresh' and never revalidates, so every subsequent request re-reads the same dangling pointer and 500s for up to `minTimeToStale` (4h at image defaults) rather than transiently. Reachable from ordinary traffic, not just the janitor: `getVariant` deletes a present variant key when the original is gone/expired (imageCache.ts:240-242) and `cascadeSource` deletes variants and placeholders (L388-416), either of which can land while a background revalidation (`cache.ts:162`) is mid-`setItem` on the same key. The L545-549 comment reasons only about rewrites and does not cover deletion, which is the gap.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-22)
