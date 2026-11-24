# [MEDIUM] Unauthenticated /mcp get_section accepts an unbounded sections array and fans out with no dedupe — memory/IO amplification DoS

**File:** [`packages/site/src/lib/mcp.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/lib/mcp.ts#L50-L83) (lines 50, 51, 55, 83)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `expensive-api-abuse`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`get_section`'s schema (L50-52) is `sections: v.array(v.object({ type: picklist, slug: v.string() }))` — no `maxLength` on the array, none on the slug. tmcp validates only against this declared schema (`tool.schema['~standard'].validate(args)`), so nothing else bounds it, and `/mcp` has no rate limit (routes.ts:137/347-348; `buildLimiter` in Mochi.ts:814 returns null with no route-level and no global `rateLimit` — contrast `/api/captcha-demo/*` in routes.ts:261-274, which are limited).

Three multipliers compound on L55-60 and L83:
1. `Promise.all(sections.map(...))` fans out the whole array concurrently.
2. `getDemoLlmsTxt` (docs.ts:201-210) has no in-flight dedupe — its `cache.demoLlmsTxt.has(slug)` guard runs synchronously before any await resolves, so N copies of the SAME valid slug all miss and all run `buildDemoLlmsTxt` in full. Each build `existsSync` + `Bun.file().text()`s every file in that demo's `files.ts` (5-15 files) and builds a fenced string.
3. `parts.join('\n\n')` (L83) materialises an N-times-duplicated response, which `tool.text` then re-serialises through `JSON.stringify(response)` plus SSE framing in the transport — roughly three live copies.

Attack: a ~4 MB POST of `{"type":"demo","slug":"charts"}` repeated ~100k times triggers ~1M concurrent file reads and a multi-GB in-memory response for a single request — an unauthenticated remote OOM/exhaustion with ~1000x amplification, no credentials and no quota.

## Recommendation

Bound the input (`v.pipe(v.array(...), v.maxLength(20))`, plus a slug `maxLength`/regex), de-duplicate `sections` before the fan-out, add an in-flight promise map to `getDemoLlmsTxt` so concurrent misses coalesce, and attach a `rateLimit` to the `/mcp` route like the captcha demo routes do.

## Revalidation

**Verdict:** true-positive

Verified every link in the chain. (1) The schema at mcp.ts:50-52 is `v.object({ sections: v.array(v.object({ type: v.picklist([...]), slug: v.string() })) })` — no `maxLength` on the array, no length/charset constraint on the slug. (2) tmcp's `tools/call` handler (node_modules/tmcp/src/index.js:483-500) validates *only* against the declared schema via `tool.schema['~standard'].validate(args)` and then calls `execute(validated_args)`; `JSONRPCRequestSchema`'s params is a `looseObject`, so the arguments survive intact, and there is no initialization gate — a single POST with `method: 'tools/call'` reaches the handler without ever calling `initialize`. (3) No rate limit: `/mcp` and `/mcp/` are `Mochi.api(({request}) => respondMcp(request))` with no options (routes.ts:137, 347-348), and the site's `Mochi.serve()` (index.ts:163-251) sets no global `rateLimit`, so `buildLimiter` (Mochi.ts:801-828) hits `if (!options.rateLimit) return null`. The `protection` PoW gate only matches `/demos/protection*`, so it does not cover `/mcp`, and no `maxRequestBodySize` is configured anywhere (Bun's 128 MB default applies). (4) The fan-out is real: `Promise.all(sections.map(...))` starts every element's async callback synchronously, and `getDemoLlmsTxt` (docs.ts:201-210) checks `cache.demoLlmsTxt.has(slug)` synchronously *before* its first await, so N requests for the same slug all miss and all run `buildDemoLlmsTxt` in full — `existsSync` plus `Bun.file().text()` for every entry in that demo's `files.ts`. Even the cheap `doc` path amplifies, because `getDocLlmsTxt` returns `doc.raw.trimEnd() + '\n'`, allocating a fresh multi-KB string per entry. (5) The response is materialised three times over: `parts.join('\n\n')`, then `v.parse(CallToolResultSchema, ...)`, then `JSON.stringify(response)` plus `TextEncoder().encode()` in the transport's `#handle_post`. A single ~1-4 MB POST of one repeated valid demo slug therefore yields tens of thousands of concurrent file-read fan-outs (preceded by a synchronous `existsSync` storm that stalls the loop) and a multi-hundred-MB-to-GB response — unauthenticated, unmetered, repeatable. Note an upstream proxy's default `client_max_body_size` (1 MB for stock nginx) would shrink but not remove the amplification (~30k entries still fits), and no proxy config is in this repo to confirm a cap. MEDIUM is appropriate: availability-only, single-site impact.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-16)
