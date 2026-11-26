# [BUG] Highlighter memo cache is bounded by entry count, not bytes, with no TTL — unbounded retention for apps highlighting user content

**File:** [`packages/mochi/src/highlight.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/highlight.ts#L39-L59) (lines 39, 44, 50, 56, 59)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-unbounded-cache`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`createHighlighter` memoizes on `key = `${language}\0${code}`` and evicts only when `cache.size >= max` (default 1000 entries). Nothing bounds the size of an entry: the key retains the complete source text and the value retains the highlighted HTML, which for token-span markup is typically several times larger, and entries never expire. The module's own comment states the intent — "insertion-ordered eviction bounds an app highlighting user content" — but the bound is on cardinality, so an attacker who can submit code to be highlighted (a snippet/comment/paste feature, i.e. exactly the contemplated case) pins roughly `cacheSize x (source + rendered)` bytes of live heap permanently: ~1000 x 200 KB sources is on the order of a gigabyte of unreclaimable memory from ~1000 cheap requests, each with a distinct body to guarantee a miss. Because the cache is per-highlighter and commonly pinned process-wide (see `pinGlobal('__mochi_site_highlight__', ...)` in packages/site/src/lib/highlight.server.ts), the memory is never released for the process lifetime, and `cache:pressure`/memory-pressure draining does not reach it since it is not a `MochiCache`.

## Recommendation

Add a byte budget alongside `cacheSize` (track `key.length + value.length`, evict until under budget) and skip memoization entirely for inputs above a threshold; hash the code into the key (e.g. `Bun.hash`) so the cache does not retain a second copy of the source; and document that `cacheSize: 0` is the right setting when highlighting untrusted input.

## Revalidation

**Verdict:** true-positive

The mechanics are exactly as described: `createHighlighter` keys on `${language}\0${code}` (highlight.ts:50) so the full source text is retained in the key, stores the wrapped HTML as the value, and evicts only on `cache.size >= max` with `max` defaulting to 1000 (lines 39, 56-59). There is no byte budget, no TTL, and because it is a plain `Map` rather than a `MochiCache` it is untouched by the `memory:pressure`/`cache:pressure` drain. The comment at 42-43 claiming 'insertion-ordered eviction bounds an app highlighting user content' is the overclaim the finding exposes — the bound is on cardinality, not bytes, so 1000 large distinct submissions pin ~1000 × (source + rendered HTML) of unreclaimable heap, and packages/site pins its highlighter process-wide via `pinGlobal`. Downgrading MEDIUM→BUG for two reasons. First, the title's 'unbounded retention' is imprecise: retention is bounded at `cacheSize` entries, just not at a byte budget, so the worst case is large rather than infinite. Second, exploitability depends entirely on an app feeding untrusted input into a public helper that nothing in this repo does (packages/site highlights only trusted docs/demo code), and the knob to disable it (`cacheSize: 0`) already exists and is documented. It is a sound hardening recommendation (byte budget, hash the key, warn in the docs) rather than a live vulnerability.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-09)
