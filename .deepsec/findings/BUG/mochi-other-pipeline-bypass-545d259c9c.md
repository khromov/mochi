# [BUG] Bare Bun route value silently opts `/demos/data-loading` out of the whole site middleware pipeline

**File:** [`packages/site/src/demos/data-loading/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/data-loading/routes.ts#L5) (lines 5)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-pipeline-bypass`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

Because the value on L5 is a plain function rather than a `Mochi.*` route, `registerRoutePattern` (Mochi.ts:885-1511) matches none of its `isMochiPage/Api/Ws/Sse/File` branches, returns `null`, and the caller assigns it verbatim: `bunRoutes[pattern] = handler as BunRouteValue` (Mochi.ts:1536). `buildRequestContext` is never invoked for this pattern, so the request skips the entire per-request pipeline that every other route on the site gets:

- the `handle` sequence from index.ts:174 — `compress()`, `analytics()`, `noCache`, `encodeDebugBarPaths`, `helloWorld`, so the response carries no `Cache-Control` and the hit is invisible to the site's Umami analytics;
- `mochiEvents.emit('request', ...)`, so the path never appears in the console access log or any request-event subscriber;
- trailing-slash canonicalization — the pattern is pushed onto `slashMirrorPatterns` (Mochi.ts:1537) so both `/demos/data-loading` and `/demos/data-loading/` are answered by the raw function with no 308 to the canonical form, and the target it emits is itself non-canonical, producing a 302 -> 308 double hop;
- `finalizeCookieHeaders`, CSRF policy, and `rateLimit`.

Nothing warns about this: the bare function is a legal `MochiRouteValue` (types.ts:309 includes `BunRouteValue`), so it type-checks cleanly and the opt-out is invisible at the call site. This is the same root cause as the Host-header finding above — reported separately because the observability and caching consequences stand even if the redirect origin is fixed.

## Recommendation

Express the redirect as a framework route so it participates in the pipeline — e.g. a `Mochi.page` whose `serverProps` returns `redirect(302, '/demos/data-loading/pikachu/')`, which also fixes the origin and the double hop. Reserve raw Bun route values for things that genuinely must bypass the pipeline (static `Response`s, HTML imports).

## Revalidation

**Verdict:** true-positive

Fully verified and distinct from F5 — the fixes are not interchangeable (emitting a root-relative `Location` from a bare Bun route value would resolve F5 and leave all of F6 intact), so I am not marking either as a duplicate. The bare function on L5 type-checks as a `MochiRouteValue` because `BunRouteValue` includes `(req, server) => Response` (types.ts:104-108, 309), `registerRoutePattern` falls through every `isMochi*` guard and returns `null` (Mochi.ts:1511), and the else branch assigns it directly: `bunRoutes[pattern] = handler as BunRouteValue` (Mochi.ts:1537). Since `buildRequestContext` is never invoked for this pattern, the request skips everything the page/api wrappers layer on: the `handle` sequence (invoked at Mochi.ts:991 for pages — so `compress()`, `immutableAssets`, `helloWorld`, `asciiDog`, `analytics()`, `encodeDebugBarPaths`, `noCache` and the demo handles from index.ts:174-185 never run, leaving the response with no `Cache-Control` and the hit invisible to Umami), the `mochiEvents.emit('request', …)` access log, `finalizeCookieHeaders`, and the CSRF/rate-limit/debug-bar policies in KIND_POLICY. The trailing-slash claim is right too: Mochi.ts:1538 pushes the pattern onto `slashMirrorPatterns`, so both `/demos/data-loading` and `/demos/data-loading/` are answered by the raw function with no 308 to the canonical form, and because the emitted target omits its own trailing slash under `trailingSlash: 'always'` the visitor pays a 302 → 308 double hop. Nothing warns at the call site. BUG severity is correct — this is an observability/caching/correctness defect, not an exploitable vulnerability.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
