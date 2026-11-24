# [MEDIUM] Unauthenticated page triggers ~20ms of blocking CPU per request with no rate limit or caching

**File:** [`packages/site/src/demos/request-cache/analyzeBook.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/request-cache/analyzeBook.ts#L34-L82) (lines 34, 35, 82)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `expensive-api-abuse`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

Every GET to the public page /demos/request-cache/ runs analyze(BOOK) once, synchronously, over a 643 KB / ~124k-word text. The author's own comment on L34 estimates 16-25ms of pure CPU per call.

The cost is paid on every single request, not once:
- requestMemo() is strictly request-scoped. Verified in packages/mochi/src/runtime/requestCache.ts: currentState() stores the map on ctx.requestCache, which is created per request and discarded at the request boundary. The memo collapses the five facet helpers (overview/topWords/themes/extremes/richness) into one execution within a request, but never across requests.
- The site configures no rate limiting whatsoever. packages/site/src/index.ts passes no `rateLimit` option; `protection` is scoped to `path === '/demos/protection'` and `/demos/protection/api*` only, so this route never sees the PoW interstitial.
- Responses are uncacheable: the `noCache` handle is in the `handle: sequence(...)` chain, so no CDN or proxy absorbs repeats.
- The route is a plain Mochi.page with no serverProps and no actions, so there is no auth, no token, and no input to throttle on.

analyze() is fully synchronous (toLowerCase over 640 KB, a 124k-iteration match, Map build, sentence split with a per-sentence regex, and a sort of ~10-15k entries), and Bun runs request handlers on a single JS thread. A trivial unauthenticated GET therefore converts into ~20ms of blocked event loop that stalls every other in-flight request. Roughly 50 req/s from one host saturates the only JS thread and degrades the entire deployed site (docs, blog, marketing pages), not just this demo. Amplification is on the order of 12-50x cheap-request-to-server-CPU.

Note also that the recomputation is functionally pointless: BOOK is a module-level constant derived from a committed static file and no request data feeds analyze(), so the result is byte-identical on every request.

Judgment call worth stating explicitly: this is demo code, and the repo's guidance is to judge packages/site/src/demos/* as documentation. I am still reporting it because, unlike the whitelisted demo shortcuts (hardcoded `hunter2`, no auth in the HN/admin/todo demos), this is a live route on the deployed mochi.fast site whose impact is site-wide availability rather than a self-contained illustrative auth gap. The expensive work is also the point of the demo, so it cannot simply be deleted. nginx is the socket peer in production (per the `proxy` comment in index.ts) and may throttle, but no nginx config lives in this repo, so I cannot treat that as a mitigation.

## Recommendation

Keep the per-request demonstration visible while bounding the cost. Options, roughly in order of preference: (1) add a `rateLimit` to this route (the framework exposes checkRouteLimit / per-route rateLimit, as used by the rate-limit demo) so a single client cannot sustain the load; (2) shrink the corpus to a few thousand words, which still shows one miss plus four hits in the debug bar's Cache tab at a fraction of the CPU; (3) wrap the whole analysis in a module-level or MochiCache layer and have requestMemo memoize over that, so the demo still shows request-scoped hit/miss counters without re-parsing the book each time. Also consider excluding /demos/request-cache from the `prefetch` speculation rule in packages/site/src/index.ts, which currently matches '/*' at eagerness 'moderate' and so triggers a full background SSR render on mere link hover from the /demos/ index.

## Revalidation

**Verdict:** true-positive

Every factual claim holds. I measured the corpus: `robinson-crusoe.txt` is 643,438 bytes / 123,973 words, read once at module load and sliced into `BOOK`. `requestMemo` is strictly request-scoped — `requestCache.ts` keys off `ctx.requestCache` on the per-request `MochiRequestContext`, which `buildRequestContext` creates fresh and which dies with the request — so the memo collapses the five facet helpers within one render but never across requests. `/demos/request-cache` is a bare `Mochi.page('./src/demos/request-cache/RequestCache.svelte')` with no `serverProps`, no actions, and no `rateLimit`; the site's `Mochi.serve()` sets no global `rateLimit` (other routes do opt in — `/api/captcha-demo/*`, `charts`, `queue`, `rate-limit`), and `protection` only covers `/demos/protection*`. `noCache` sets `Cache-Control: no-cache` with no ETag, so no proxy absorbs repeats. `analyze()` is fully synchronous — `toLowerCase()` over 640 KB, a ~124k-match global regex, a 124k-insert Map, a second ~124k-match pass across ~10-15k sentences, then a sort — and Bun runs handlers on one JS thread, so each hit blocks the event loop for every other in-flight request (the author's own comment estimates 16-25 ms; my read of the work suggests that is conservative). The `prefetch` speculation rule at `href_matches: '/*'`, eagerness `moderate`, does not exclude this path, so link hover alone triggers a full SSR render. The recomputation is also genuinely pointless: `BOOK` is a module constant and no request data feeds `analyze`. Keeping MEDIUM rather than treating this as excluded demo code: unlike the enumerated demo shortcuts (hardcoded `hunter2`, shared module state, missing auth), the impact here is event-loop starvation that degrades the whole deployed site, a single cheap GET is the whole attack, and the fix (a per-route `rateLimit`, already used by siblings) does not alter what the demo demonstrates.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-31)
