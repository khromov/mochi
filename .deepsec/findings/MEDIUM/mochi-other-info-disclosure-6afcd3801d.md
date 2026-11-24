# [MEDIUM] Newsletter confirm/unsubscribe capability tokens are exported to the Umami analytics backend

**File:** [`packages/support/src/newsletter/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/support/src/newsletter/routes.ts#L84-L110) (lines 84, 88, 106, 110)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-info-disclosure`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

Both token pages take their sole authorization factor in the query string: `/newsletter/confirm/?token=…` (L88) and `/newsletter/unsubscribe/?token=…` (L110). Both are rendered through the normal HTML shell, and `packages/support/src/index.ts` L41 installs `analytics({ exclude: [NEWSLETTER_EMBED_PATH] })` — the exclusion list covers only `/newsletter/embed`, so these two paths ARE tracked. The tracker injected by `packages/shared/src/analyticsTracker.html` loads `https://u.khromov.se/u.js` with only `data-website-id` and `data-performance` set; it does NOT set `data-exclude-search="true"`, which is Umami's documented opt-out for query-string recording (added in v2.11.0). Umami therefore reports `pathname + search` and persists the full token-bearing URL in its own database, where it is readable in the dashboard's URL report. The leaked values are live capability tokens, not opaque session ids: `confirm_token` is valid for CONFIRM_TTL_MS (14 days by default) and `unsubscribe_token` is never rotated for the lifetime of the row (db.server.ts has no statement that updates it). Anyone with read access to the Umami property — a separate origin and a separate trust domain from support.mochi.fast — can replay a captured token to confirm a pending signup on a third party's behalf, or to unsubscribe a confirmed subscriber. Because the pages act on GET with no CSRF or intent check (an intentional trade-off for one-click List-Unsubscribe), a captured URL is immediately actionable. Note the authors already guard the adjacent indexing leak with `<meta name="robots" content="noindex">` in TokenPage.svelte, so the exposure class is recognised — the analytics channel was just missed.

## Recommendation

Add both token paths to the analytics exclusion list: `analytics({ exclude: [NEWSLETTER_EMBED_PATH, '/newsletter/confirm', '/newsletter/unsubscribe'] })` in index.ts. Also set `data-exclude-search="true"` on the tracker in packages/shared/src/analyticsTracker.html so no future token-bearing route leaks by default. The durable fix is to stop putting the token in a tracked URL at all: read it once in serverProps, then 303-redirect to a bare `/newsletter/confirmed/` result page so the token never reaches the rendered (and tracked) page. Adding `Referrer-Policy: no-referrer` to these two responses closes the matching referrer channel for non-default-policy clients.

## Revalidation

**Verdict:** true-positive

The leak itself is verified end to end. Both token pages take the token from the query string (L88, L110) and render through the normal shell; packages/support/src/shell.html contains `{{mochi.analytics}}`; `analytics({ exclude: [NEWSLETTER_EMBED_PATH] })` (index.ts L41) excludes only `/newsletter/embed`, and packages/shared/src/index.ts injects the tracker for any non-excluded path whenever `MOCHI_DOCKER === 'true'` — which Dockerfile.production sets (L75), the image used to deploy this package. analyticsTracker.html sets only `data-website-id` and `data-performance`, not `data-exclude-search`, and Umami's documented behaviour is to collect the query string unless that attribute is set (it was added in v2.11.0), so the full token-bearing URL is POSTed to u.khromov.se and persisted there. I also confirmed `unsubscribe_token` is never rotated — only `subInsertStmt` ever writes it; `subReArmStmt` refreshes `confirm_token` but not the unsubscribe one — and that TokenPage.svelte already carries `<meta name="robots" content="noindex">`, so the exposure class was recognised and this channel simply missed. One correction to the impact narrative: the pageview that logs a token is the same request that performs the action, so a logged `confirm_token` is already spent (a replay hits the `status === 'confirmed'` branch and returns 'already'), and a logged `unsubscribe_token` has already been used. The residual capability is narrower than stated — the never-rotated unsubscribe token can re-unsubscribe anyone who later re-subscribes, and any future flow change (or a prefetch-then-log ordering) re-opens the rest. I keep MEDIUM because writing live capability tokens into an off-origin analytics store with its own access model is the finding class (CWE-598/532) and the fixes offered — adding both paths to `exclude`, `data-exclude-search`, and redirecting to a bare result page — are all cheap and correct.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-15)
