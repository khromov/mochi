# [MEDIUM] Analytics tracker injected on token-bearing URLs leaks newsletter confirm/unsubscribe tokens to a third party

**File:** [`packages/shared/src/index.ts`](https://github.com/khromov/mochi/blob/main/packages/shared/src/index.ts#L20-L27) (lines 20, 26, 27)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-token-leak-to-third-party`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`analytics()` returns a Handle whose `transformPage` fills `{{mochi.analytics}}` with the Umami tracker on every `text/html` response. `packages/support/src/index.ts:41` mounts it site-wide as `sequence(adminAuth, embedHeaders, analytics({ exclude: [NEWSLETTER_EMBED_PATH] }))`, and `packages/support/src/shell.html:123` carries the placeholder, so the tracker is injected into every page of that app.

Two of those pages carry a secret in the query string. `packages/support/src/newsletter/routes.ts:84` and `:106` define `/newsletter/confirm` and `/newsletter/unsubscribe` as `Mochi.page` routes that read `url.searchParams.get('token')` and act on it with no other authentication — the route comment states it plainly: "the token is the authorisation". The `exclude` list contains only `NEWSLETTER_EMBED_PATH` ('/newsletter/embed'), so neither token page is excluded and `enabled` evaluates true for both.

The injected tracker (`analyticsTracker.html`) sets only `data-website-id` and `data-performance`; `data-exclude-search` is not set, so Umami's default `url` payload (`pathname + search`) carries the token to `https://u.khromov.se` where it is stored in the analytics database. Independently of Umami's exact defaults, the deeper problem is that a third-party script is loaded into a document whose URL is itself a bearer credential, giving that script full read access to `location.href`.

This is live in production: `Dockerfile.production:75` sets `ENV MOCHI_DOCKER=true`, which is the switch `isDocker` reads, and that image is what deploys `packages/support`.

Impact: anyone with access to the Umami dashboard, its logs, or its database can replay a captured token to confirm a pending subscription on the recipient's behalf (defeating double opt-in) or to unsubscribe an address. Tokens also persist in analytics storage far longer than `CONFIRM_TTL_MS`, and the unsubscribe token has no expiry at all.

Note also that `exclude` matching is exact-string on `event.url.pathname` after stripping one trailing slash, so it is not normalized for case or percent-encoding — a path that still routes but renders differently (e.g. `/newsletter/%65mbed/`) would also escape an exclusion.

## Recommendation

Add the token-bearing paths to the exclude list at `packages/support/src/index.ts:41` (`'/newsletter/confirm'`, `'/newsletter/unsubscribe'`). Better, make the handle safe by default: add `data-exclude-search="true"` to `analyticsTracker.html` so no query string is ever reported, and/or give `analytics()` an option to report a sanitized pathname only. Longer term, move the token out of the query string — accept it as a path segment that the route strips before rendering, or POST it from a confirm button — so it is never handed to client-side script at all.

## Revalidation

**Verdict:** true-positive

The whole chain holds. `analytics()` installs a `transformPage` that fills `{{mochi.analytics}}` on every `text/html` response; `packages/support/src/index.ts:41` mounts it site-wide as `sequence(adminAuth, embedHeaders, analytics({ exclude: [NEWSLETTER_EMBED_PATH] }))` and `support/src/shell.html:123` carries the placeholder. `NEWSLETTER_EMBED_PATH` is only `/newsletter/embed` (embedHeaders.ts:4), while `newsletter/routes.ts:84` and `:106` define `/newsletter/confirm` and `/newsletter/unsubscribe` as `Mochi.page` routes whose sole authorization is `url.searchParams.get('token')` — the route comment says so outright. `stripTrailingSlash('/newsletter/confirm/')` yields `/newsletter/confirm`, which is not in the exclude Set, so `enabled` is true. Tokens are `randomBytes(32).toString('base64url')` (db.server.ts:251) placed in the query string by `confirmUrl`/`unsubscribeUrl` (newsletter/config.ts). `analyticsTracker.html` sets only `data-website-id` and `data-performance`; I confirmed via Umami's documentation that `data-exclude-search` defaults to off, i.e. the tracker reports `pathname + search` and the token lands in the analytics store. Production reach is confirmed: `Dockerfile.production:75` sets `ENV MOCHI_DOCKER=true`, and `.github/workflows/build.yml:67-72` builds the `support` workspace from `Dockerfile.production` and deploys it as `mochi-support`/support.mochi.fast. No CSP constrains script-src (embedHeaders only sets `frame-ancestors`, and only on the embed path). Two honest mitigations the finding understates: `u.khromov.se` is the project owner's own self-hosted Umami, so 'third party' is really 'third-party-hosted script plus token sprawl into analytics storage'; and the worst outcome is an unauthorized newsletter confirm (defeating double opt-in) or unsubscribe, not account compromise. The unsubscribe token never expires, though, and tokens persist in analytics far beyond `CONFIRM_TTL_MS`. The closing remark about `/newsletter/%65mbed/` is speculative (an undecoded pathname likely fails to route at all) but immaterial. MEDIUM stands for a live production bearer-credential-in-URL leak.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-05)
