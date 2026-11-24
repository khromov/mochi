# [MEDIUM] Unvalidated `__mochiBlob` / `__mochiBlobRef` sentinel turns cached data into an arbitrary-file-read handle

**File:** [`packages/mochi/src/cache/cache-storage.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/cache/cache-storage.ts#L45-L582) (lines 45, 54, 55, 560, 561, 562, 580, 582)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `path-traversal`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`decodeBlobs()` classifies any stored object with a string `__mochiBlob` property as an on-disk blob pointer (`isBlobPointer`, L54-56) and returns `{ __mochiBlobRef: true, path: join(this.directory, value.__mochiBlob), bytes }` (L582). `path.join` normalizes `..` segments, so a pointer value of `../../../../etc/passwd` resolves to `/etc/passwd`; the exported `readBlobRef()` (L45-47) then reads that path with no containment check against `this.directory`. The symmetric gap exists on write: `encodeBlobs()` accepts any object shaped like a `BlobRef` and re-points at it via `relative(this.directory, value.path)` (L560-562), so a crafted `{__mochiBlobRef: true, path: '/etc/shadow', bytes: 1}` is persisted as a `../`-laden pointer that decodes back to the absolute path on every later read.

Crucially this decode path is unconditional — the comment at L577-579 states that both sentinels are self-describing so entries decode "regardless of the flag" — so the default `offloadBinary: false` configuration is affected too, even though it never writes a blob file itself. `encodeBlobs` leaves a non-binary object with a `__mochiBlob` key untouched (it falls through to the generic object branch at L567), JSON stores it verbatim, and `decodeBlobs` promotes it to a filesystem reference on read.

The four `__mochi*` sentinel names are reserved by the on-disk format but are neither documented as reserved nor validated. The published docs (`packages/docs/145-cache.md`) tell users that any JSON-serializable value round-trips and that `readBlobRef(ref)` / `isBlobRef(value)` are how you resolve and narrow a binary field — so the vulnerable pattern is the documented one. Attack path: an app caches untrusted structured data (an upstream API response, a webhook body, a user profile document) through `new MochiCache({ storage: new FileStorage(...) })`; the attacker plants `{"__mochiBlob": "../../../../../../etc/passwd", "bytes": 1}` in a nested field; on the next cache read that field is a `BlobRef`, and the app's `isBlobRef(x) ? await readBlobRef(x) : x` branch discloses the file. Even without a `readBlobRef` call, the decoded `path` leaks absolute server paths into whatever the app does with the value.

Not currently reachable through the framework's own consumer: `ImageCache` stores a fixed `StoredImage`/`StoredPlaceholder` shape whose only binary field (`bytes`) comes from `fetchSource`/`runPipeline` as a real `Uint8Array`, so no attacker-shaped object reaches the sentinel check there. The defect is in the library primitive, not in its in-tree caller.

## Recommendation

Validate pointers on both sides of the round-trip. On decode, require the pointer to match the format the writer actually produces (`/^[0-9a-f]{64}\/[0-9a-f]{64}\.bin$/`) and verify `resolve(join(this.directory, rel)).startsWith(resolve(this.directory) + path.sep)` before constructing a `BlobRef`; treat a mismatch as opaque data (return the object unchanged) rather than as a pointer. On encode, reject a `BlobRef` whose `path` is not already inside `this.directory` instead of silently emitting a `../` relative pointer. Add the same containment assertion inside `readBlobRef`, and document the `__mochiBlob` / `__mochiBinary` / `__mochiBlobRef` / `__mochiKey` keys as reserved.

## Revalidation

**Verdict:** true-positive

I verified every mechanical claim in the current source. `getItem` (L309-326) calls `this.decodeBlobs(parsed.__mochiValue)` unconditionally — there is no `offloadBinary` gate on the decode side, confirmed both by reading the method and by the existing test at cache-storage-file.test.ts:529 ('entries written with offloadBinary on still read as BlobRefs after the flag is dropped'), which makes flag-independent decoding an intentional design property. `isBlobPointer` (L54-56) requires only that the object carry a *string* `__mochiBlob` property — `bytes` is never validated and `readBlobRef` doesn't even read it — and `decodeBlobs` (L582) builds `path: join(this.directory, value.__mochiBlob)` with no `resolve`/`startsWith` containment check, so `'../../../../etc/passwd'` normalizes out of the cache dir. `readBlobRef` (L45-47) then does `Bun.file(ref.path).arrayBuffer()` with no check of its own. The encode-side mirror is real too: `encodeBlobs` leaves a plain object with a `__mochiBlob` key untouched (it falls through to the generic object branch at L567-572) and converts any `{__mochiBlobRef:true, path}` shape into `relative(this.directory, value.path)` (L560-562), so an absolute path round-trips as a `../`-laden pointer. `isBlobRef`/`readBlobRef` are public exports (`index.ts:27`) and `packages/docs/145-cache.md:160` documents exactly the vulnerable idiom ('Resolve one with `readBlobRef(ref)`, and narrow a value with `isBlobRef(value)`') while the Callout promises that any JSON-serializable value round-trips and never reserves the `__mochi*` keys. Concrete attack: an app caches an attacker-shaped structured document (upstream API response, webhook body, user-controlled JSON column) through `MochiCache({storage: new FileStorage(...)})`; the attacker plants `{"__mochiBlob":"../../../../../../etc/passwd"}` in a nested field; the next read promotes it to a `BlobRef` and the app's documented `isBlobRef(x) ? readBlobRef(x) : x` branch discloses the file. I confirmed the finding's own honest caveat: no in-tree consumer is reachable — `MemoryStorage` never encodes/decodes at all, `ImageCache` stores a fixed `StoredImage`/`StoredPlaceholder` shape whose only binary field comes from `fetchSource`/`runPipeline` as a real `Uint8Array`, and `packages/site/src/lib/ci.ts`'s dev-only `FileStorage` holds app-mapped GitHub data. So this is a latent arbitrary-file-read in a published library primitive rather than a live hole in the deployed sites — MEDIUM is the right rating, and the repo's own 'patterns to flag' list already treats joining an untrusted name onto an output directory without rejecting `..` as in scope.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-22)
