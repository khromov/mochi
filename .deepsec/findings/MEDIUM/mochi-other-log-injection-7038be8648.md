# [MEDIUM] URL-decoded route param reflected into unsanitized server log line

**File:** [`packages/site/src/demos/file/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/file/routes.ts#L16-L18) (lines 16, 17, 18)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** low  •  **Slug:** `other-log-injection`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The resolver's 404 path interpolates the route param into the error message: error(404, `No file named "${name}"`). Bun URL-decodes route params, so `name` can contain raw control characters including CR/LF. The framework's file-route catch block logs that message verbatim — `logger.error(`${req.method} ${url.pathname} → ${err.status}: ${err.message}`)` at packages/mochi/src/Mochi.ts:1499 — and packages/mochi/src/utils/log.ts forwards its args straight to console.error with no escaping or newline stripping. A request to /demos/file/dynamic/x%0A%5Bmochi%5D%20forged%20line injects a newline into stdout, letting an attacker forge or spoof log entries and potentially confuse a downstream line-oriented log aggregator. Note the request-event logger elsewhere logs `url.pathname + url.search`, which stays percent-encoded, so this decoded message is the only place a raw newline reaches the log. Explicitly NOT an XSS: the same message is returned as the response body but with Content-Type `text/plain; charset=utf-8`, which no current browser sniffs into HTML. Path traversal is also fully mitigated here — the exact-match ALLOWED Set permits only 'sample' and 'notes', and the framework independently confines the resolved path via realpath + path.relative containment against process.cwd() plus dotfile rejection.

## Recommendation

Do not echo the raw param. Either drop it from the message (`error(404, 'File not found')`) or sanitize before interpolation, e.g. `const safe = name.replace(/[^\w.-]/g, '')` / `JSON.stringify(name)`. A durable framework-side fix is to strip CR/LF from interpolated values in packages/mochi/src/utils/log.ts before writing to the console.

## Revalidation

**Verdict:** true-positive

Verified end-to-end. Bun route params reach the resolver URL-decoded — asserted twice in-repo: the code comment at Mochi.ts:1463 ('Route params are URL-decoded and may contain `../`') and the live test at file.test.ts:118-126, which proves an encoded `../` chain arrives verbatim. The ALLOWED miss calls `error(404, ...)`, which throws `MochiHttpError` (utils/index.ts:82-92) carrying the decoded `name` as `.message`. The file-route catch block takes the `instanceof MochiHttpError` branch at Mochi.ts:1497-1501 and does `logger.error(`${req.method} ${url.pathname} → ${err.status}: ${err.message}`)`; utils/log.ts:38-43 forwards that straight to `console.error` with no escaping or control-character stripping, and the site's `logger: { level: 'log' }` (index.ts:199) is level 4, so `error` (1) is emitted. I found a second sink the finding missed: line 1500's `emitError('file', …)` copies the same message onto the `error` event, which consoleLogger renders into an `ERR` line (dev/consoleLogger.ts:162-167), and the site's `consoleLogger:line` filter only nulls `/health` paths — so one request forges lines through two independent console writers. The finding's own negatives also check out: `url.pathname` stays percent-encoded (URL parsing preserves it), so that half of the line is safe; traversal is genuinely dead (exact-match Set, plus realpath + `path.relative` containment + `isExcludedDotPath` at Mochi.ts:1466-1485); and the body is `text/plain; charset=utf-8`, so no XSS. This is CWE-117, trivially reachable unauthenticated on the deployed site. Keeping MEDIUM only because no lower security tier exists in this scheme — the real-world impact is log forgery on container stdout, the bottom of that band. One honest caveat: per the static-only constraint I did not execute a request, so Bun's specific handling of `%0A` in a `:name` segment is inferred from the repo's own documented decoding behaviour rather than observed; nothing in the path filters control bytes.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-06-12)
