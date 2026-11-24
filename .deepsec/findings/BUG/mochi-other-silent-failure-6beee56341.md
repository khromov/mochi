# [BUG] A failing image-cache sweep is invisible to the event bus, and sweeps can overlap

**File:** [`packages/mochi/src/image/sweeper.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/image/sweeper.ts#L21-L28) (lines 21, 22, 23, 24, 28)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-silent-failure`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`runSweep` emits `image:cache-sweep` only on success (L21); every failure is swallowed into a single `logger.warn` (L22-24) with no `cache:error` emission, no event, and no backoff. Because `ImageCache` builds its `FileStorage` with `purgeInterval: 0` (imageCache.ts:166), this sweeper is the ONLY janitor for the image cache, so a persistently failing sweep means the cache is persistently under-reclaimed while all telemetry built on `image:cache-sweep` simply goes quiet rather than reporting a problem. This is reachable in practice: `FileStorage.sweep()` fans out an uncapped `Promise.all` over every directory entry and, with `reportKeys: true` (which `ImageCache.sweep` always passes), performs an extra full file read per expired entry — on a large cache that can exhaust file descriptors, and an EMFILE is not ENOENT so it rejects the whole sweep. Each run still makes partial progress before rejecting, so this degrades reclamation and loses all accounting rather than halting it outright. Separately, `setInterval` is given an async callback with no re-entrancy guard (L28), so a sweep slower than `intervalMs` overlaps with the next, multiplying filesystem load against a shared cache directory.

## Recommendation

Emit a failure event (e.g. `cache:error` or an `image:cache-sweep` carrying an error field) instead of only warning, so a stalled janitor is observable. Add an in-flight guard (`let running = false`) around `runSweep` so an overrunning sweep skips the next tick rather than stacking.

## Revalidation

**Verdict:** true-positive

Every specific claim checks out. `runSweep` emits `image:cache-sweep` only on the success path (L21) and funnels all failures into one `logger.warn` (L22-24) with no event; `cache:error`'s `operation` union is `'get' | 'set' | 'remove' | 'clear'` (events.ts:190), so no existing event covers a sweep failure, even though the cache subsystem does emit failure events elsewhere (`cache:error`, `cache:revalidate:failed`) — so this is a genuine hole rather than a subsystem-wide convention of silence. The load-bearing premise is confirmed: `ImageCache` builds its `FileStorage` with `purgeInterval: 0` (imageCache.ts:166), so this sweeper is the only janitor for the image cache, and for a `storage:` override like the documented `MemoryStorage({ maxAge })` too. Failure is reachable without any misconfiguration: `FileStorage.sweep` fans an uncapped `Promise.all` over every directory entry, `reportKeys: true` (which `ImageCache.sweep` always passes) adds a full `readKey` file read per expired entry, and pass 1's catch tolerates only ENOENT — so one EMFILE, EACCES, or (on Windows) an EPERM/EBUSY unlink against a concurrently-open file rejects the whole sweep, after partial progress. Repeated failures mean monotonic cache growth with `image:cache-sweep` telemetry simply going quiet. The re-entrancy gap is real too: `setInterval(runSweep, intervalMs)` with an async callback and no in-flight flag, which matters once `sweepIntervalMs` is set low or the directory is very large; overlap is not corrupting (duplicate unlinks mostly ENOENT) but duplicates FS load and can itself provoke the Windows unlink failures above. Two honest caveats that cap severity at BUG: `DEFAULT_LOG_LEVEL` is `'warn'` (utils/log.ts:23), so failures are visible on stderr by default and are only truly silent under `logLevel: 'error'`; and `FileStorage.startSweeper` has the identical log-only/no-guard shape. Both recommendations (emit a failure event, add `let running = false`) are correct and cheap.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-17)
