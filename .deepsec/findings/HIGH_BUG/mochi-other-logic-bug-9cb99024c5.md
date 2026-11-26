# [HIGH_BUG] All five page fixtures use slashless paths, so the harness only exercises the trailing-slash redirect and never renders a page

**File:** [`packages/mochi/scripts/leak/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/scripts/leak/routes.ts#L11-L31) (lines 11, 12, 16, 21, 31)
**Project:** mochi
**Severity:** HIGH_BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`packages/site/src/index.ts:172` sets `trailingSlash: 'always'`. For `kind: 'page'`, `KIND_POLICY` enables the trailing-slash policy (`runtime/requestSetup.ts:63`), and `buildRequestContext` evaluates it as the FIRST early-exit, before CSRF, before the cookie jar, and long before any SSR render (`requestSetup.ts:107-117`). `trailingSlashRedirect` returns a redirect for any non-exempt slashless path (`runtime/trailingSlash.ts:19-20`) — 301 for GET/HEAD, 308 for POST (`trailingSlash.ts:53`). Every page fixture here targets a slashless path: `/demos/hello-world` (L11), `/demos/data-loading/pikachu` (L12), `/demos/data-loading/pikachu` POST (L16), `/demos/server-island` (L21), `/demos/error/404` (L31). None are slash-exempt (`isSlashExempt` only exempts `/` and paths with a file extension; none of these contain a dot). `loadGen.ts:105` sets `redirect: 'manual'`, so the harness never follows them.

Net effect: for the full default 600s workload at 50 rps, the only routes that do real work are the two `Mochi.api` hits (`/health`, `/api/cookie` — `api` kind has `trailingSlash: false`). Not a single Svelte component is server-rendered, no island props are serialized, no form action executes, and `ComponentRegistry`'s `compiledComponents` / `clientFiles` / `cssFileUrls` maps stay empty — directly contradicting README step 3 ('Lets ComponentRegistry populate…') and the 'Routes hit' section ('minimal page render, page with dynamic param + cookie jar, form action'). The harness measures the redirect responder.

This is masked rather than surfaced: `loadGen.ts:116-118` buckets the responses as `status3xx` and still increments `totalRequests` (L122), leaving `totalErrors` at 0, so `errorRate` is 0 and the verdict gates never fire. A reader who studies the per-route table in `printReport` would see `0/N/0/0` columns, but the automated pass/fail and exit code are blind to it. This is also precisely the trap called out in the repo's own CLAUDE.md ('Always request routes with a trailing slash … `packages/site` sets `trailingSlash: 'always'`, so a slashless path just 308-redirects').

## Recommendation

Append a trailing slash to every page fixture path (`/demos/hello-world/`, `/demos/data-loading/pikachu/`, `/demos/server-island/`, `/demos/error/404/`). Then add a guard in `runLeakTest.ts` that hard-fails the run when any route's `status3xx` exceeds a few percent of its count, so a future trailing-slash or routing change can't silently hollow out the workload again. Consider asserting a non-zero 2xx count per fixture before the workload phase begins.

## Revalidation

**Verdict:** true-positive

Confirmed end-to-end against current HEAD (1cb3f3ce). `packages/site/src/index.ts:172` sets `trailingSlash: 'always'`; `KIND_POLICY.page.trailingSlash` is true (requestSetup.ts:63); `mirrorsSlashForm` causes Mochi.ts:1546-1553 to register the alt-slash variant so Bun matches the slashless form; and the page handler's `wrapRequest` (Mochi.ts:961-971) calls `buildRequestContext` as its very first statement, where the trailing-slash check at requestSetup.ts:107-117 is the first early exit — before CSRF, the cookie jar, protection, middleware, or any render. `isSlashExempt` (trailingSlash.ts:5-7) exempts only `/` and paths matching `/\.[^./]+$/`; none of `/demos/hello-world`, `/demos/data-loading/pikachu`, `/demos/server-island`, `/demos/error/404` contain a dot, so all five page fixtures get a 301 (GET) or 308 (POST) from trailingSlash.ts:53. `loadGen.ts:105` sets `redirect: 'manual'`, so the harness never follows them, and L116-118 bucket them as `status3xx` while L122 still counts them as successful requests — which is exactly why F1 keeps the verdict green. I verified the site registers no `trailingSlash:redirect` filter (its only filter is `consoleLogger:line`, index.ts:245-247) and no middleware rewrites the URL, so nothing mitigates this. Ring math: 7 routes at weight 1 (10 slots) plus `unmatched:404` at 0.3 (3 slots) = 73 slots, so ~68.5% of the default workload is pure redirect responses. Two supporting details in the finding are inaccurate and I note them for the record: (a) `warmup: { enabledInProd: true }` (index.ts:196) plus Mochi.ts:2127-2135 renders every static page pattern once at boot using the canonical slashed path, and a production run loads the registry from the manifest, so `compiledComponents`/`clientFiles`/`cssFileUrls` are NOT empty; (b) `unmatched:404` falls through to `composedFetch`, which renders the configured error page via `renderErrorResponse` (Mochi.ts:1911-1918), so that ~4% of traffic does SSR a Svelte component. Neither touches the core defect: the five page fixtures never re-render their pages under load, the form action never executes, and island props are never re-sealed. The repo's own CLAUDE.md warns about precisely this trap. HIGH_BUG stands.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
