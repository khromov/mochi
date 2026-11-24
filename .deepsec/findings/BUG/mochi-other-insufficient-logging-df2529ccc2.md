# [BUG] silenceInternalRoutes drops all /_mochi/* and /__mochi/admin/* log lines regardless of status or level, blinding the logs for internet-facing endpoints

**File:** [`packages/mochi/src/dev/consoleLogger.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/dev/consoleLogger.ts#L431-L554) (lines 431, 435, 438, 554)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-insufficient-logging`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`silenceInternalRoutes` returns `null` for any path starting with `/__mochi/admin`, `/_mochi/` or `/__mochi_live_reload` (L435-443), and `emit()` applies it as the *last* step, after the 5xx/slow escalation to `warn` (L546-557). So the drop is unconditional: a 500, a 403, a 10-second response or a flood of requests to those prefixes produces no output at all.

The prefix is far broader than "framework-internal noise" suggests. `/_mochi/` is the asset prefix, which also covers security-relevant, internet-facing endpoints: the server-island endpoint `/_mochi/island/:name` (which decrypts attacker-supplied sealed props), the image transform endpoint (which fetches partially attacker-influenced URLs), and — on the dev-mode deployed apps — the email viewer and its attachment download. `/__mochi/admin` covers the unauthenticated page-cache admin routes. This filter is installed by four apps including both deployed ones (`site/src/index.ts:246`, `demos/src/index.ts:30`, `support/src/index.ts:82`, `minimal`), and those same routes are explicitly exempted from the global rate limiter (Mochi.ts), so an attacker enumerating island names, hammering the image transformer, or scraping the outbox leaves neither a rate-limit trace nor a log line — and a crashing server island is invisible to the operator.

## Recommendation

Make the filter level-aware instead of path-only: keep the line when `level === 'warn'` (i.e. 5xx and slow responses, which `emit` has already escalated) or when `status >= 400`, and silence only successful, fast internal traffic. The filter already receives `level` and `status` in its context, so this is a two-line change; document that apps wanting total silence should write their own filter.

## Revalidation

**Verdict:** true-positive

The mechanism is exactly as described and I confirmed it line by line: `silenceInternalRoutes` (L431-445) branches on `path` alone, ignoring the `level` and `status` it receives in context, and `emit` applies `consoleLogger:line` at L554 — after the 5xx/slow escalation at L549 — returning early when the filter yields `null`. So a 500 or a 10-second response under `/_mochi/*` or `/__mochi/admin*` produces no output, which contradicts the filter's own docstring describing it as dropping 'framework-internal noise'. Four apps install it, including both deployed ones. The concrete, verified consequence: a 5xx from the image transform endpoint (`${assetPrefix}/image/:filename`, Mochi.ts:1707) emits a `request` event that escalates to warn and is then silently dropped, as are all request/`error`-event lines for the email viewer, client-stats page and page-cache admin. Two of the finding's most alarming illustrations are wrong, however, which is why I am downgrading it. The server-island endpoint (Mochi.ts:1559) emits **no** `request` event at all, so enumeration there is unlogged for a different reason than the filter. And 'a crashing server island is invisible to the operator' is false: Mochi.ts:1633 calls `logger.error('Server island "X" failed: …')` directly, and direct `logger.*` calls never pass through `consoleLogger:line` (only `emit()` applies it), while `island:error` has no `consoleLogger` subscription at all — so island failures do reach the log. What is left is a real but non-exploitable observability gap in an opt-in, app-chosen filter whose events remain available on `mochiEvents` for any app wiring its own pipeline; the two-line level-aware fix the finding proposes is correct, but this is a defect in the filter rather than a security vulnerability, hence BUG.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-22)
