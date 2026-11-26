# [MEDIUM] Dev-mode deployment leaks stack traces and mounts three unauthenticated internal route families in production

**File:** [`Dockerfile`](https://github.com/khromov/mochi/blob/main/Dockerfile#L79) (lines 79)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-info-disclosure`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

Same root cause as the CSRF finding — `ENTRYPOINT ... bun run dev:${WORKSPACE}` (L79) sets `NODE_ENV=development`, so `development === true` on the deployed mochi.fast and demos sites. Beyond CSRF, that flips several disclosure switches with no auth in front of any of them:

Error responses: packages/mochi/src/Mochi.ts:743 returns the raw exception `message` to the client instead of `'Internal Server Error'`; Mochi.ts:527-528 attaches `err.stack` to the JSON error payload; packages/mochi/src/runtime/errors.ts:93-96 attaches `thrown.stack` to the rendered error page's props; Mochi.ts:1639 attaches `e.stack` on the island path. Stack traces expose absolute container paths, internal module layout, and framework/dependency internals, which is reconnaissance for any other bug.

Internal routes: Mochi.ts:786-792 builds `internalRoutes` from `debugBarEnabled` (= `development && (options.debugBar ?? true)`, Mochi.ts:503 — the site does not set `debugBar: false`) and `emailViewerEnabled` (= `development && emailTransportType === 'dev'`, Mochi.ts:619; packages/mochi/src/email/config.ts:12 defaults the transport to `dev` whenever `development` is true and no `email` option is given — the site gives none). All three are therefore live and publicly reachable:
  - `/_mochi/client/stats` (dev/clientStatsRoutes.ts:10) — `registry.getClientStats()`, which the framework's own comment at Mochi.ts:787-788 describes as disclosing "every bundle's input file paths and sizes — project structure and dependency names". Note the site's `encodeDebugBarPaths` handle only re-encodes paths inlined into the HTML debug globals; it does not cover this page.
  - `/__mochi/admin/page-cache` + `/stats` + `/entries` (dev/pageCacheAdminRoutes.ts:57-64) — an unauthenticated route literally named `admin`, with `purgeAll` / `purge` form actions.
  - `/_mochi/email`, `/_mochi/email/attachment` (dev/emailViewerRoutes.ts:101-106) — reads the dev outbox, streams arbitrary stored attachment bytes, and exposes a `clear` action; emailViewerRoutes.ts:71 states "Dev-only (only mounted while the `dev` transport is active), so no auth beyond that gate", and that gate is open here.

Mitigating facts I verified, which is why this is MEDIUM and not higher: the page-cache admin data is hardcoded stubs and its purge actions are no-ops (pageCacheAdminRoutes.ts:25-47), and neither deployed site has any `sendEmail` caller, so the outbox the viewer reads stays empty. The durable exposure is the stack traces and the bundle-path/structure disclosure, plus a standing `admin`-named unauthenticated surface that becomes real the moment the page-cache implementation lands.

## Recommendation

Deploy with NODE_ENV unset (use Dockerfile.production) so `development` is false, which simultaneously restores generic 500 bodies, drops the stack traces, and unmounts all three internal route families. If the debug bar genuinely must be visible on the deployment, gate the internal routes on something other than `development` — and in particular require an explicit opt-in (or auth) for the email viewer and the page-cache admin routes before that implementation stops being a stub.

## Revalidation

**Verdict:** true-positive

Same root cause as F1 but a materially different exposure and a different fix, so I am not marking it duplicate. The stack-trace leak is real and trivially reachable: `errors.ts:93-96` attaches `thrown.stack` to the error page's props when `development`, and `templates/DefaultError.svelte` renders it verbatim in a `<pre>` under a "Stack trace" heading. The site sets no `errorPage`, so that default is in use, and `packages/site/src/demos/error/routes.ts` registers `/demos/error/500` on `Error500.svelte`, whose script is literally `throw new Error(...)` — so an anonymous `GET https://mochi.fast/demos/error/500/` renders a full stack trace with container-absolute paths. All three internal route families are confirmed live: `debugBarEnabled = development && (options.debugBar ?? true)` is true (site sets no `debugBar`), mounting `buildClientStatsRoutes` (`/_mochi/client/stats`, disclosing `getClientStats()` = every bundle output's input paths and sizes) and `buildPageCacheAdminRoutes` (`/__mochi/admin/page-cache` + `/stats` + `/entries`, with `purgeAll`/`purge` actions); `emailViewerEnabled = development && transport==='dev'` is true because `email/config.ts:12` defaults the transport to `dev` in development and the site passes no `email` option. Two corrections, neither of which changes the verdict. (1) The finding's mitigation "neither deployed site has any sendEmail caller" is wrong — it grepped the internal symbol; the public API is `Mochi.email()`, and `packages/site/src/demos/email/routes.ts` calls it from two form actions, so `/_mochi/email` on mochi.fast is populated. The disclosed content is harmless (fixed server-side presets to the hardcoded `ada@example.com`), but the viewer, its `clear` action and the attachment byte-stream are genuinely live, not inert. (2) `Mochi.ts:527-528` attaches `err.stack` to the `mochiEvents.emit('error')` payload — server-side observability, not an HTTP body — and `Mochi.ts:743` returns only `err.message`; the client-visible stack leak is errors.ts:93 and Mochi.ts:1639. I also found unmentioned corroboration: `Mochi.ts:1731-1765` mounts `/_mochi/image-cache` under the same `debugBarEnabled` gate as a raw Bun route (bypassing `buildRequestContext`, so no CSRF and no protection gate), where a bare POST calls `cache.clearAll()` — an unauthenticated purge that forces re-transcoding of every image. I confirmed the page-cache admin is hardcoded stubs with no-op purges, as the finding states. MEDIUM is right: the aggregate (anonymous stack traces, an unauthenticated image-cache purge, a standing `admin`-named surface) is real, while confidentiality impact is blunted because the repo and Dockerfile are public, so the disclosed layout is largely already known.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-10-26)
