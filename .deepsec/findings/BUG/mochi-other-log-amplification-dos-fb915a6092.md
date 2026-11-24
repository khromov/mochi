# [BUG] Unauthenticated always-throwing routes emit two full stack traces per request with no rate limit

**File:** [`packages/site/src/demos/error/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/error/routes.ts#L6-L14) (lines 6, 14)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-log-amplification-dos`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`/demos/error/500` and `/demos/error/redirect` register `Error500.svelte`, whose `<script>` unconditionally throws on every SSR render. Both are public, unauthenticated GET pages on the production site (mochi.fast) and neither declares a `rateLimit` option; `packages/site/src/index.ts` sets no server-wide rate limit either (only `/api/captcha-demo/*` and the rate-limit demo opt in).

Each hit on `/demos/error/500/` is logged twice with a full stack trace: the site's `handleError` logs `logger.error('app:', pathname, error)` (index.ts:53) because `error && status >= 500`, and then the framework logs it again at `packages/mochi/src/runtime/errors.ts:89` (`if (status >= 500 && thrown) logger.error(...)`) because the hook returned `void` and did not short-circuit. A third `logger.info` line is emitted at index.ts:49. With `logger: { level: 'log' }` all three pass the level gate.

The result is a cheap request-to-log-volume amplifier: a single trivial GET with no body produces multiple kilobytes of stack-trace output, plus an uncached errorPage SSR render (`noCache` is in the handle sequence, so nothing is cached). Under a container json-file log driver without rotation, sustained requests grow log storage far faster than ordinary traffic and can exhaust host disk, taking the service down. Compute amplification is negligible; the realistic impact is bounded to log/disk volume and the operational cost of a log pipeline flooded with meaningless traces, which also makes real 500s hard to spot. The duplicate logging is a plain bug independent of the DoS angle: `handleError` is invoked before the framework's own 5xx log, so any app that logs 5xx inside the hook and returns `void` double-logs every server error.

## Recommendation

Add a `rateLimit` option to the deliberately-throwing demo routes (e.g. `Mochi.page('./src/demos/error/Error500.svelte', { rateLimit: { limit: 10, window: '1m' } })`) so hammering them is bounded, and drop the redundant `logger.error('app:', ...)` from the site's `handleError` in `packages/site/src/index.ts:52-54` (the framework already logs 5xx with the thrown error at `runtime/errors.ts:89`) — or keep it and have `handleError` return a `MochiErrorInfo`/`Response` so only one trace is written. Independently, ensure log rotation/size caps are configured for the deployed containers.

## Revalidation

**Verdict:** true-positive

Every mechanical claim checks out. `Error500.svelte` is three lines and its `<script>` throws unconditionally, so both `/demos/error/500` and `/demos/error/redirect` fail on every SSR render; neither declares `rateLimit`, and site/src/index.ts has no server-wide limit. I traced the logging precisely through `runtime/errors.ts`: `renderErrorResponseInner` invokes `handleError` at line 69, which emits `logger.info('handleError: …')` (index.ts:49) and `logger.error('app:', pathname, error)` (index.ts:53, since `error && status >= 500`), then returns `undefined` because the redirect branch tests `'/demos/error/redirect/'`; control reaches line 89-91 and the framework logs the 5xx with the thrown error a second time. `logger: { level: 'log' }` is level 4, above both `error` (1) and `info` (3), so all three lines print — one info line plus two full stack traces, exactly as claimed. The finding is careful to attribute the doubling only to `/demos/error/500/`, which is right: for `/demos/error/redirect/` the hook returns a Response and line 75 returns before the framework's log, so that route emits one trace. The error page is also uncached (`noCache` sets `Cache-Control: no-cache` on the `page`-kind response, which has none). So the duplicate-logging defect is genuine and the comment at errors.ts:87-88 confirms the framework deliberately logs after the hook, making the app's own `logger.error` redundant. I'm downgrading MEDIUM to BUG because the DoS framing is thin: amplification is ~30-70x in log bytes, the attacker's achievable rate is bounded by the full error-page SSR the server performs for any page, and the disk-exhaustion endpoint depends on an unrotated Docker json-file driver — an ops configuration gap, not a code defect. The durable, actionable content here is the redundant 5xx log plus the absence of a bound on deliberately-throwing public routes.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
