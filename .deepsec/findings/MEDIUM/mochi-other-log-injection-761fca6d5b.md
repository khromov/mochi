# [MEDIUM] Attacker-controlled slug interpolated into log lines without sanitization or length clamp

**File:** [`packages/site/src/lib/mcp.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/lib/mcp.ts#L75-L78) (lines 75, 78)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-log-injection`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

L75 and L78 interpolate caller-supplied slugs straight into log output: `logger.log('[mcp] get_section [' + found.join(', ') + '] → ...')` and `logger.warn('[mcp] get_section not found: ' + missing.join(', '))`. `slug` is `v.string()` (L51) with no charset or length restriction, reached unauthenticated via `/mcp`.

A slug containing newlines forges log records — e.g. `slug = "x\n[mcp] get_section [doc:intro] → 1 found\nhandleError: /admin → 200"` writes attacker-authored lines into the server's console/log stream, which is the same sink `consoleLogger` and `handleError` (index.ts:47-58) write to. Because the not-found branch logs on every miss, an attacker can also flood logs (unbounded slug length × unbounded array length) to bury real events or fill the log volume. Unlike the resource findings this needs no volume to be effective — one request is enough to forge a line.

## Recommendation

Validate the slug shape at the schema (`v.regex(/^[a-z0-9-]+$/)`, `v.maxLength(64)`) and/or strip CR/LF and truncate before interpolating into a log message. Logging the count plus the already-validated internal slugs, rather than the raw request values, also works.

## Revalidation

**Verdict:** true-positive

The core claim is correct but only one of the two cited lines is actually injectable, and I want that on record. L78 — `logger.warn(`[mcp] get_section not found: ${missing.join(', ')}`)` — interpolates the *raw, unvalidated* request slug: `missing` is populated whenever `content === null`, i.e. precisely for slugs that matched nothing, so the value is fully attacker-controlled. `slug` is `v.string()` with no charset or length constraint, JSON string literals can carry `\n` and `\u001b`, and `logger.warn` (packages/mochi/src/utils/log.ts:44-49) does `console.warn(yellow('[mochi]'), ...args)` with no neutralisation of control characters — so a slug containing CR/LF (optionally with the dim-ANSI `[mochi]` prefix reproduced) writes attacker-authored lines into the same stdout stream that `consoleLogger` and `handleError` (index.ts:47-58) write to. The site sets `logger: { level: 'log' }` unconditionally, and the deployed image runs `bun run dev:site`, so both log calls are live in production. One request is enough; textbook CWE-117, plus ANSI-escape injection against any operator tailing the logs. L75, however, is **not** injectable: `found` only contains ids whose content resolved non-null, and every resolver requires an exact match against a known slug (`getDoc` → `cache.bySlug.get`, `getPost` → `cache.bySlug.get`, `getDemoLlmsTxt` → `internalDemos().find(d => d.slug === slug)`, or the literal `changelog`), so those slugs are server-side values, not request values. `type` is a picklist and is never injectable on either line. Keeping MEDIUM because the impact is log integrity/forgery rather than confidentiality or privilege — it would arguably be LOW on a finer scale, but MEDIUM is the floor here.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-16)
