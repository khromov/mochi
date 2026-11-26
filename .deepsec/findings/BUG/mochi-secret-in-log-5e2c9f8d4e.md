# [BUG] `request`/`error` event `path` carries the query string despite being documented as the pathname, leaking URL-borne tokens to logs and metrics sinks

**File:** [`packages/mochi/src/events.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/events.ts#L12-L13) (lines 12, 13)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `secret-in-log`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`MochiRequestEvent.path` is documented here as the request path, and docs/147-events.md's `request` table states `path` = "URL pathname" (extensions.ts:41 likewise: "For requests this is the URL path"). Every emission site actually passes `url.pathname + url.search` — Mochi.ts:1002 (page), 1250 (api), 1276 (ws reject), 1797 (file), the image endpoint, `emitError` at Mochi.ts:522, and runtime/requestSetup.ts:101 for early exits. Consumers therefore receive secrets they were told were not there: `consoleLogger` prints `path` verbatim into stdout (dev/consoleLogger.ts:79, 538-544), and the documented subscriber example forwards it to a third-party metrics vendor (`metrics.timing('http.request', duration, { method, path, status })`). In this monorepo the values at risk are real bearer credentials: the newsletter confirm/unsubscribe tokens whose GET-with-token design is explicitly the authorization mechanism, sealed server-island props (`?props=`), signed image payloads, and captcha tokens. At the production default level (`'warn'`) only 5xx and slow lines print, which narrows but does not close it — a slow or failing `/newsletter/confirm?token=...` logs the token — and docs/146-logging.md:48 presents `level: 'info'` ("page/api/file requests") as a normal choice, where every request URL including its query is written out. Secondary effect: `silenceInternalRoutes` compares `path === '/.well-known/appspecific/com.chrome.devtools.json'` (dev/consoleLogger.ts:432), which now fails to match whenever a query string is present.

## Recommendation

Pick one contract and enforce it. Preferably emit `url.pathname` in `path` and expose the query separately (e.g. an opt-in `search` field consumers must choose to log), or — if the full target is wanted — rename the field to `url`/`target`, update the type JSDoc and docs/147-events.md, and have `consoleLogger` redact the query string by default with an opt-in to show it.

## Revalidation

**Verdict:** true-positive

The contract mismatch is real. docs/147-events.md:110 documents the `request` event's `path` as 'URL pathname', and extensions.ts:41 says 'For requests this is the URL path', while every emission site passes `url.pathname + url.search` — Mochi.ts:1002 (page), 1250 (api), 1276 (ws reject), 1454 (file), 1715 (image), 1927 (asset/fallback), 522 (emitError), and requestSetup.ts:101 for early exits. dev/consoleLogger.ts:76-83 forwards `payload.path` into `emit`, which prints it verbatim (line 541), and the docs' own subscriber example at 147-events.md:50-51 passes `path` as a third-party metrics tag. The secondary bug is also real: `silenceInternalRoutes` compares `path === '/.well-known/appspecific/com.chrome.devtools.json'` (consoleLogger.ts:432), an exact match that now fails whenever a query string is present (the sibling checks use `startsWith` and still work). Two corrections. The finding over-attributes the doc error: 147-events.md:311/331/341 document `error`, `action:invoke` and `action:complete` as 'URL pathname + search', i.e. correctly, and `MochiRequestEvent.path` carries no JSDoc at all in events.ts — only the `request` table is wrong. And at the production default `level: 'warn'`, only 5xx/slow lines print (emit escalates on `status >= 500 || duration >= slow`), so routine URLs are not written out by default. Downgrading to BUG: logging the full request target is conventional practice, so the defect here is the typed/documented contract diverging from the implementation (plus the broken exact-match filter), not a novel secret-exposure channel.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-22)
