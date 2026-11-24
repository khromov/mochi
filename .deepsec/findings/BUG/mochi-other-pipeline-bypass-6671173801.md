# [BUG] /hn is a raw Bun route value, so it bypasses the entire Mochi request pipeline and double-redirects

**File:** [`packages/demos/src/hn/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/demos/src/hn/routes.ts#L5) (lines 5)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-pipeline-bypass`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

A bare function is not a `Mochi.page`/`Mochi.api` — `MochiRouteValue` (types.ts:309) also admits `BunRouteValue`, and `Mochi.ts`'s registration loop falls through to `bunRoutes[pattern] = handler as BunRouteValue` for anything the `isMochi*` guards reject. Consequences for this route:

- The app's `handle` middleware (`immutableAssets`) never runs.
- `buildRequestContext` never runs, so there is no CSRF check, no trailing-slash policy, no `rateLimit` enforcement, and no cookie finalization.
- No `mochiEvents.emit('request', ...)` is emitted, so the route is invisible to `consoleLogger()` and to any metrics subscriber — it silently does not appear in request logs.

Separately, the fallthrough branch mirrors raw route values onto both slash forms, so `/hn` and `/hn/` both answer. Both redirect to `/hn/front` *without* a trailing slash, but the app sets `trailingSlash: 'always'`, so `/hn/front` immediately 308s to `/hn/front/` — every visit to `/hn` costs two redirects instead of one.

## Recommendation

Redirect to the canonical `'/hn/front/'` (with the trailing slash), and prefer a framework route kind over a raw function so the route participates in middleware, rate limiting, and request events.

## Revalidation

**Verdict:** true-positive

Verified end-to-end in the framework. All five `isMochi*` guards begin with `typeof value === 'object'` (types.ts:53, 88, 100, 237, 255), so a bare arrow function fails every one; `registerRoutePattern` returns null and Mochi.ts:1537 falls through to `bunRoutes[pattern] = handler as BunRouteValue`, with the adjacent comment confirming 'Raw Bun route values (static Responses, HTML imports) answer on both slash forms' and lines 1546-1551 doing the mirroring. Because the value is assigned straight into `bunRoutes`, it never passes through `wrapRequest` (called only at Mochi.ts:1012 and 1028, inside the page branch), so there is no request context, no CSRF, no rate-limit check, no cookie finalization, no `handle` middleware, and no `mochiEvents.emit('request', …)` — the observability hole is the most concrete consequence, since the route is simply absent from `consoleLogger()` output. The double redirect is real and on the primary in-app path: Landing.svelte:23 links `/hn/`, the mirrored raw route answers it and returns `Location: /hn/front` without a slash, and `trailingSlash: 'always'` redirects again. One factual correction: `trailingSlashRedirect`'s `permanentRedirect` (runtime/trailingSlash.ts) issues **301** for GET/HEAD and 308 only for other methods, so a browser's second hop is a 301, not the 308 stated. The practical security impact of the listed bypasses is nil for this specific route — demos configures no global `rateLimit` (grep of index.ts is empty), the route sets no cookies, and CSRF is irrelevant to a GET redirect — which is why BUG rather than a security severity is right. I deliberately did not collapse this into F3: although both anchor on line 5, they are distinct defects with distinct root causes (F3 is which URL you read; F4 is which route kind you register) and either would survive fixing the other.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
