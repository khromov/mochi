# [MEDIUM] Unbounded, never-evicted global cache keyed on caller-supplied slug (negative results cached too)

**File:** [`packages/site/src/lib/docs.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/lib/docs.ts#L65-L208) (lines 65, 201, 208)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `cache-key-poisoning`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`cache.demoLlmsTxt` is a `Map` pinned on `globalThis` via `pinGlobal` (L55-66). `getDemoLlmsTxt(slug)` writes an entry for EVERY slug it is asked about, including misses: `buildDemoLlmsTxt` returns `null` for an unknown demo and L208 still does `cache.demoLlmsTxt.set(slug, result)` — the comment explicitly says it caches 'the null "no such demo" result'. Nothing ever evicts entries: `clearDocsCaches()` (L68-76) is only wired to dev-only `file:change` events in index.ts:30-44, so in production the map only grows.

The slug is attacker-controlled. `lib/mcp.ts:57` calls `getDemoLlmsTxt(slug)` for `type === 'demo'`, where `slug` is declared `v.string()` (mcp.ts:51) with no length or charset bound, and `/mcp` + `/mcp/` are registered unconditionally and unauthenticated in routes.ts:347-348 with no `rateLimit` config. I confirmed `buildLimiter` in Mochi.ts:801-828 returns `null` when neither the route nor `Mochi.serve({ rateLimit })` sets one — and packages/site sets neither — so there is no quota on this endpoint. Bun's default `maxRequestBodySize` applies (128 MB; the framework never overrides it).

Attack: POST a JSON-RPC `tools/call` for `get_section` with `sections` full of `{"type":"demo","slug":"<long random string>"}`. Every distinct slug is retained forever as a UTF-16 JS string key. A few MB of request body per round, repeated, walks the process heap up until the container OOMs; the site's own test suite demonstrates the insertion path (`mcp.test.ts:148-151` caches `nope-1`/`nope-2`). Note the map is shared across module copies (that is what `pinGlobal` is for), so the growth is process-wide.

## Recommendation

Don't memoize misses, and bound the key space: validate the slug against the known demo list before touching the cache (`if (!filesForDemo(slug)) return null;`), or key the cache off the resolved internal demo object rather than the raw input. Belt-and-braces: cap the map (LRU) and give the MCP tool's slug a `v.pipe(v.string(), v.maxLength(64), v.regex(/^[a-z0-9-]+$/))` schema.

## Revalidation

**Verdict:** true-positive

Every element of the chain checks out. `cache.demoLlmsTxt` is a plain `Map` inside the `pinGlobal('__mochi_site_docs_cache__')` object (`docs.ts:55-66`), so it is process-wide and survives duplicate bundled copies. `getDemoLlmsTxt` (L201-210) memoizes unconditionally, including misses — `buildDemoLlmsTxt` returns `null` at L214 for an unknown slug and L208 still inserts it, as the comment states. The only eviction is `clearDocsCaches()`'s `.clear()` at L75, reachable solely from the dev-only `file:change` subscription at `index.ts:30-34`, which filters on `.md` files under `DOCS_DIR` — nothing rewrites those at runtime in the container, so in a deployed process the map is append-only forever. The key is attacker-controlled: of the three call sites, `demoLlmsRoutes` and `buildDemosTxt` both iterate fixed slugs from `internalDemos()`, but `mcp.ts:57` forwards the request's `slug` straight through for `type === 'demo'`, and its schema at `mcp.ts:51` is `v.string()` inside an unbounded `v.array()` — no length, charset, or array-size limit. `/mcp` and `/mcp/` are registered unconditionally at `routes.ts:347-348` with no `rateLimit` option, and I confirmed in `Mochi.ts:801-829` that `buildLimiter` returns `null` when neither the route nor `Mochi.serve({ rateLimit })` supplies a config — `packages/site/src/index.ts` sets neither, so the endpoint is entirely unmetered. I also read `@tmcp/transport-http/src/index.js`: `#handle_post` checks only `Content-Type: application/json` before `request.clone().json()`, imposes no body cap, and `tmcp` has no initialize-before-call requirement (no 'not initialized' guard exists) and no OAuth is configured, so a single anonymous POST reaches `get_section`. Concrete attack: POST a `tools/call` for `get_section` with a large `sections` array of `{"type":"demo","slug":"<unique>"}` entries; every distinct slug is retained permanently as a UTF-16 Map key with per-entry overhead exceeding the ~31 bytes it cost to send, so the retained heap grows faster than the request body and repeats are free. Even if an upstream nginx `client_max_body_size` caps bodies at 1 MB, ~32k permanent entries per request with no quota reaches a container OOM in a few hundred requests; the unbounded `Promise.all` fan-out over the same array adds a transient CPU/allocation spike. MEDIUM is the right severity for an unauthenticated resource-exhaustion DoS. One note on framing: the `cache-key-poisoning` slug is a misnomer — distinct slugs cannot displace legitimate entries — but the substantive impact the description argues (unbounded, never-evicted growth driven by unvalidated input) is confirmed.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-08)
