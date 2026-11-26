# [MEDIUM] Framing protection exists only on the newsletter embed path, leaving /admin/ clickjackable

**File:** [`packages/support/src/embedHeaders.ts`](https://github.com/khromov/mochi/blob/main/packages/support/src/embedHeaders.ts#L21-L28) (lines 21, 24, 28)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-clickjacking`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

embedHeaders is the only code in the support app (and in mochi-framework) that emits a framing policy, and it applies that policy to exactly one path. Line 24 returns the untouched response for every pathname that is not /newsletter/embed or a child of it, so no other response carries `frame-ancestors` or `X-Frame-Options`. A grep across packages/mochi/src and packages/support/src finds no other `X-Frame-Options`, `frame-ancestors`, or `Content-Security-Policy` emission, and newsletter.test.ts:120-124 codifies this as intended ('the CSP is scoped to the embed', asserting the header is null on `/`). The result is that https://support.mochi.fast/admin/ can be framed by any origin.

That matters because Mochi's CSRF defence is an Origin-header comparison with no per-request token (runtime/csrf.ts:149-155: if the request's Origin equals the resolved expected origin, the check returns null and the POST proceeds). A form POST issued from inside a framed copy of /admin/ is a same-origin navigation of that frame, so it arrives with `Origin: https://support.mochi.fast`, which matches `proxy.origin` (MOCHI_ORIGIN, set in index.ts:38) exactly. CSRF therefore does not stop a UI-redress click the way it stops a cross-site form post.

The admin page renders plain SSR POST forms for state-changing actions (src/admin/SubscriberRow.svelte and src/routes.ts:114-155): `?/handle`, `?/unhandle`, `?/resendConfirmation` and `?/unsubscribeSignup` are single-click, and `?/deleteSignup` -- which calls deleteSubscriber() and permanently removes a subscriber row -- is two clicks behind a <details> summary. Attack scenario: an attacker hosts a page that embeds https://support.mochi.fast/admin/ in a transparent, precisely positioned iframe under a decoy button, and gets an operator who is authenticated to the panel to visit it; the operator's click lands on 'Unsubscribe' or on the Delete summary followed by 'Confirm delete', destroying newsletter subscriber data or silently marking support submissions handled so they are never triaged. The attacker cannot read the framed page (cross-origin), so this is a write-only attack, but the write is destructive and unrecoverable (the subscriber list is explicitly called out as unrecoverable in .env.example).

One caveat on exploitability: /admin/ is gated by HTTP Basic (adminAuth.ts), so the attack depends on the browser attaching cached Basic credentials to a frame nested in a cross-site document. Firefox and Safari do not partition the HTTP auth cache by top-level site, so the credentials ride along there; Chrome's auth-cache partitioning can blunt it. The missing header is unconditional regardless, and the same gap also leaves the public form at / and the newsletter token pages frameable.

## Recommendation

Make the handle emit a restrictive default instead of returning the response untouched: for any path that is not the embed, set `Content-Security-Policy: frame-ancestors 'none'` (and, for older-browser coverage on these non-embed paths only, `X-Frame-Options: DENY`). Keep the existing allow-list branch for /newsletter/embed so the widget still embeds cross-origin. At minimum gate /admin* this way, since that is where the destructive one-click actions live. Extend newsletter.test.ts's 'the CSP is scoped to the embed' test to assert `frame-ancestors 'none'` on / and /admin/ rather than a null header, so the default cannot silently regress.

## Revalidation

**Verdict:** true-positive

Verified in code: `embedHeaders` is the only framing-policy emitter in the whole repo, and line 24 returns the untouched response for every path that is not `/newsletter/embed` or a child of it. I grepped `packages/mochi/src`, `packages/support/src` and `packages/site/src` for `X-Frame-Options`, `frame-ancestors` and `Content-Security-Policy`: the only hits are embedHeaders.ts:28 and the two assertions in newsletter.test.ts, and `src/shell.html` carries no meta CSP, so `/admin/` and `/` ship with no framing policy at all. newsletter.test.ts:120-124 does codify the gap ('the CSP is scoped to the embed', asserting the header is null on `/`). The CSRF analysis is also correct: `csrfCheckDefault` (csrf.ts:149-155) passes any POST whose `Origin` equals the resolved expected origin, and a form submitted from inside a framed copy of the panel is a same-origin navigation of that frame, so it arrives with the matching Origin and no per-request token exists to catch it. The destructive one-click targets are real — `?/handle` / `?/unsubscribeSignup` are single buttons with only a hidden `id`, and `?/deleteSignup` sits two clicks deep behind a `<details>` and reaches `deleteSubscriber()`, which hard-DELETEs the row (db.server.ts:314-319). The one place this finding is stronger than reality is the browser caveat it already flags: modern browsers partition the HTTP auth cache by top-level site (Chrome's default is the `GloballyScopeHTTPAuthCacheEnabled=false` behaviour, and Firefox's dFPI network-state partitioning covers HTTP authentication), and cross-origin iframes do not get an auth prompt — so on a default current browser the framed `/admin/` renders 'Unauthorized' rather than the panel, and exploitation needs a legacy client, an embedded webview, or an enterprise policy that globally scopes the cache. The missing header is unconditional and application-side nothing prevents the attack, so I keep this as a real finding at MEDIUM, read as a hardening gap on an authenticated destructive surface rather than a wide-open hole. Note this is the same defect F3 reports from index.ts; this entry is the more precise one because the early `return response` here is the actual defect site.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-27)
