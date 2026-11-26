# [MEDIUM] Admin panel is framable by any origin; one-click destructive POSTs defeat the Origin-based CSRF check

**File:** [`packages/support/src/index.ts`](https://github.com/khromov/mochi/blob/main/packages/support/src/index.ts#L41) (lines 41)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-clickjacking`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`embedHeaders` (wired at L41) sets `Content-Security-Policy: frame-ancestors …` only for `/newsletter/embed*` (embedHeaders.ts:24) and deliberately sets no `X-Frame-Options` at all. The framework ships no framing default (grep across packages/mochi finds none) and src/shell.html has no meta CSP, so `/admin/` and `/` are framable by any origin. The app's own test asserts this: `newsletter.test.ts:120-124` checks `Content-Security-Policy` is null on `/`.

Attack: the admin authenticates with HTTP Basic, so the browser caches the credential per-origin and attaches it to *any* subsequent request to support.mochi.fast, including subresource/iframe loads. evil.com frames https://support.mochi.fast/admin/ (authenticated, renders fully) and overlays bait over the panel's plain SSR forms. Those forms are state-changing and mostly one-click: `?/unsubscribeSignup` and `?/handle` (SubscriberRow.svelte:36-40, SubmissionCard.svelte:31-34), plus `?/deleteSignup` behind a two-click `<details>` (SubscriberRow.svelte:45-51) — all with only a hidden `id` field and no per-form token.

The framework's CSRF defense cannot stop this: csrfCheck compares the `Origin` header against `proxy.origin`, and a form submitted from inside the iframe carries `Origin: https://support.mochi.fast` — indistinguishable from a genuine click. Result: an attacker can get the logged-in admin to permanently delete subscriber rows or unsubscribe them.

## Recommendation

In `embedHeaders`, replace the early `return response` for non-embed paths with a default deny: set `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY` on everything that is not the embed path (the handle already rebuilds the response, so this is a two-line else-branch). Keep the allow-list form only for `/newsletter/embed*`.

## Revalidation

**Verdict:** true-positive

Same underlying defect as F2 but reported at the wiring site (index.ts:41), and since the duplicate verdict is only valid within a single file I assessed it on its own merits; the code facts check out identically. `sequence(adminAuth, embedHeaders, analytics(...))` installs the only handle chain, `embedHeaders` adds `frame-ancestors` for `/newsletter/embed*` alone, no framework default exists, and `src/shell.html` has no meta CSP — so `/admin/` is framable by any origin, exactly as the app's own `newsletter.test.ts:123` asserts. The forms it names are right (SubscriberRow.svelte:31-51, SubmissionCard.svelte:29-32: plain SSR POSTs with only a hidden `id`), `deleteSignup` really does destroy a row, and the Origin-equality CSRF check cannot distinguish a frame-sourced POST from a genuine click. Where F3 overstates relative to F2 is its central premise, asserted at 'high' confidence: 'the browser caches the credential per-origin and attaches it to *any* subsequent request to support.mochi.fast, including subresource/iframe loads'. That is pre-partitioning behaviour. Chrome scopes the HTTP auth cache to the top-level site by default (the `GloballyScopeHTTPAuthCacheEnabled` policy exists precisely to turn that off), Firefox partitions HTTP authentication as part of default Total Cookie Protection network-state partitioning, and all mainstream browsers suppress auth prompts in cross-origin frames — so on a current default browser the framed panel is unauthenticated and the clicks land on nothing. I still rate it a genuine finding because the header is absent unconditionally, nothing in the application mitigates it, and non-partitioning clients (older browsers, webviews, policy-overridden Chrome) reopen the exact chain described; severity stays MEDIUM. The recommendation is sound and is a two-line else-branch in embedHeaders.ts.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-27)
