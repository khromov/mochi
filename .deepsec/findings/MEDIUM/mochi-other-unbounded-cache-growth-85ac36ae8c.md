# [MEDIUM] itemCache has only age-based eviction, so id enumeration grows it without bound

**File:** [`packages/demos/src/hn/hn-cache.ts`](https://github.com/khromov/mochi/blob/main/packages/demos/src/hn/hn-cache.ts#L3-L7) (lines 3, 7)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-unbounded-cache-growth`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The comment here shows the risk was considered — 'Item ids come from the URL, so the default unbounded MemoryStorage would grow one entry per distinct id forever' — but the chosen mitigation bounds entry *age*, not entry *count*. `MemoryStorage` (packages/mochi/src/cache/cache-storage.ts:92-148) is a plain `Map` whose only eviction is `sweep()`, which deletes entries where `now - writtenAt > maxAge`; it exposes no `maxEntries` or byte cap.

Attack path: `/hn/item/:id` is public, and `fetchItem` accepts any safe positive integer, so an attacker walking ids inserts one distinct `item:<id>` entry per request. Resident set is bounded only by (request rate x 600s), with each entry holding a full serialized HN item — a comment's `text` field can be multiple kilobytes. Sustained enumeration grows the heap until the process is OOM-killed, which is especially cheap here because the app configures no rate limiting at all (no `rateLimit`/`protection` anywhere in `packages/demos/src`).

Partial mitigation: `MemoryStorage`'s constructor calls `registerPressureResponder(this)`, and `respondToPressure('critical')` calls `clear()`. But `memoryPressure.ts`'s own comment notes 'the OS signal never fires on a healthy Linux box', and on Linux only `'critical'` is reported — i.e. the backstop engages when the kernel is already choosing between the cache and the process, not as a cap. Note the cache keys themselves are clean: the id is integer-validated before interpolation, so there is no cache-key poisoning or namespace collision here.

## Recommendation

Give the cache a hard ceiling in addition to `maxAge` — an LRU/entry-count cap on the storage backend (or `FileStorage` for this volume) — and add a `rateLimit` to the `/hn/item/:id` route so a single client cannot drive unbounded distinct-key inserts.

## Revalidation

**Verdict:** true-positive

Verified, and the deployed configuration is actually worse than the finding assumes. `MemoryStorage` (cache/cache-storage.ts) is a plain `Map` whose only eviction is `sweep()` deleting entries where `now - writtenAt > maxAge`; its options are just `maxAge`/`purgeInterval`, with no `maxEntries` or byte cap anywhere — so the mitigation added by 1289d8f8 bounds age, not count, and that commit's own message frames the fix as exactly 'MemoryStorage({ maxAge: 600_000, purgeInterval: 60_000 })'. `/hn/item/:id` is public (routes.ts:11) and `fetchItem` accepts any safe positive integer, so id walking inserts one distinct `item:<id>` key per request with nothing capping the count, and packages/demos/src configures no rate limit at all. The memory-pressure analysis is accurate — `MemoryStorage`'s constructor calls `registerPressureResponder`, `respondToPressure('critical')` calls `clear()`, Linux reports only 'critical', and memoryPressure.ts carries the verbatim comment 'the OS signal never fires on a healthy Linux box' — but I found the backstop is not even installed here: Mochi.ts:2071 guards it with `if (!development && (options.memoryPressure ?? true))`, and build.yml deploys demos on the dev-mode root Dockerfile, whose line 5 states that `bun run dev:<workspace>` sets NODE_ENV=development, so `development` is true and `installMemoryPressureHandler()` is skipped entirely. The finding's cache-key observation is correct and fairly conceded: the id is integer-validated before interpolation, so there is no key poisoning. The one imprecision is the title — growth is bounded by (insert rate x 600s) rather than literally unbounded, though the body says so correctly — but the requested hard entry-count ceiling is the right ask, and MEDIUM is appropriate for a memory-exhaustion path on a deployed public route with no rate limit.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-06)
