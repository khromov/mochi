# [BUG] Superseded blob files are never reclaimed for a continuously-refreshed key, so the entry folder grows without bound

**File:** [`packages/mochi/src/cache/cache-storage.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/cache/cache-storage.ts#L336-L556) (lines 336, 341, 344, 450, 463, 464, 477, 491, 545, 556)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-resource-leak`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

Blobs are content-addressed as `<keyHash>/<sha256(bytes)>.bin` (L556), so when an entry is rewritten with different bytes the new blob lands in a *new* file inside the *same* folder and the previous one is deliberately left in place (L545-549, and the test at cache-storage-file.test.ts:413-430 asserts an outstanding lazy `BlobRef` still reads its own generation). The comment states superseded blobs are "reclaimed with the whole entry folder by `removeItem` or the sweep" — but neither reclaims them while the entry stays in use:

- `setItem` never enumerates or prunes the folder; it only `mkdir`s and writes (L336-349).
- Sweep pass 1 removes a folder only when its owning `<hash>.json` ages out past `maxAge` by **mtime** (L450-465) — and every revalidation renames a fresh temp over that JSON (L355), resetting its mtime. A key that is requested at least once per `maxAge` window therefore never ages out.
- Sweep pass 2 only reclaims folders whose owning JSON is *gone* (L477-494), which by definition excludes a live entry.

Failure scenario with the framework's own consumer: `ImageCache` constructs `FileStorage` with `offloadBinary: true` and `maxAge = timeToEvict` (imageCache.ts:166; defaults `timeToStale` 4h / `timeToEvict` 24h). A remote source whose bytes change — a CMS URL reused across edits, a rotating banner, a webcam still — regenerates every ~4h under steady traffic, and each distinct generation permanently adds a full-size original plus one blob per configured size to folders that are never swept because traffic keeps refreshing their JSON mtime. Growth is bounded only by how often upstream bytes change and the process lifetime, and image blobs are the large-binary case this code path exists for.

A smaller companion leak: blob temp files are written as `<keyHash>/<digest>.bin.<uuid>.tmp` (L344) *inside* the folder, but pass 1 only examines top-level non-directory entries, so a crash mid-blob-write leaves a `.tmp` that no sweep pass can ever see while the entry lives.

## Recommendation

Prune the entry folder after a successful JSON rename in `setItem`: list `<keyHash>/`, keep the digests referenced by the just-written pointer set, and unlink the rest after a grace window (reuse `ORPHAN_BLOB_GRACE_MS`) so an in-flight lazy `BlobRef` from the previous generation can still complete. Have that same pass drop stale `*.bin.*.tmp` debris. Alternatively, age blob files individually in sweep pass 1 by their own mtime rather than only via whole-folder removal.

## Revalidation

**Verdict:** true-positive

Confirmed on all three reclamation paths. `setItem` (L336-349) only `mkdir`s and writes blobs it doesn't already find on disk — it never enumerates or prunes `<keyHash>/`. Sweep pass 1 (L443-473) keys off the *owning JSON's* mtime, and `setItem` writes a fresh temp (`open(path,'w')`) and renames it over `<hash>.json` (L352-355), so every revalidation resets that mtime; a key refreshed at least once per `maxAge` can therefore never age out, and the folder `rm` at L463-464 is reached only via that aged-out branch. Sweep pass 2 (L477-494) explicitly only touches folders whose owning JSON is *absent*, which by construction excludes a live entry. The L545-549 comment's claim that superseded blobs are 'reclaimed with the whole entry folder by removeItem or the sweep' is thus false for a continuously-refreshed key, and the test at cache-storage-file.test.ts:412-428 confirms retention is deliberate ('The superseded blob is left on disk (reclaimed with the folder later)'). The ImageCache scenario checks out numerically: `imageCache.ts:166` builds `FileStorage({maxAge: maxTimeToLive, purgeInterval: 0, offloadBinary: true})`, `image/config.ts:103-104` defaults `timeToStale` to 14_400_000 (4h) and `timeToEvict` to 86_400_000 (24h), and `sweeper.ts` drives `cache.sweep(Date.now())` into exactly that pass-1 mtime check. A source whose upstream bytes change (CMS re-upload at a stable URL, rotating banner) regenerates roughly every 4h under steady traffic; each distinct byte generation adds a new content-addressed blob under the same original and variant key hashes, and the refreshing JSON mtime keeps those folders out of pass 1 indefinitely. Identical bytes do dedupe (same digest → the `exists()` skip at L341), and `markStale` re-persisting a read-back `BlobRef` pushes nothing onto `blobs`, so neither of those inflates the folder — the leak is strictly one blob per changed generation, which is what the finding says. The companion `.tmp` claim is also correct: blob temps are written as `<keyHash>/<digest>.bin.<uuid>.tmp` *inside* the folder (L344) while pass 1's `readdir` is top-level only (no `recursive`), so crash debris there is invisible to both passes while the entry lives.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-22)
