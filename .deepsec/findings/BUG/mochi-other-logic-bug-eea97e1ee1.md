# [BUG] Unvalidated username length produces an oversized cookie and a false "signed in" state

**File:** [`packages/site/src/demos/login/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/login/routes.ts#L16-L25) (lines 16, 18, 19, 24, 25)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`username` is taken straight from the form with no length or shape validation (`String(formData.get('username') ?? '').trim()`); only emptiness is checked. It is then base64url-embedded into the signed token (`session.ts:19`) and written as a cookie value. Browsers cap a cookie at ~4096 bytes of name+value and silently discard anything larger, and base64 inflates the payload by 4/3 — so a username of roughly 3000 characters (trivially pasted into the unbounded `<input name="username">` in EnhancedLoginForm.svelte:56) yields a token the browser throws away. The action still returns `success({ username })`, and the hydrated island sets `currentUser = result.data.username` (EnhancedLoginForm.svelte:24-27), so the UI renders "Signed in as …" for a session that does not exist; the next navigation re-runs `serverProps`, finds no cookie, and shows the login form again. Secondary effects: at larger sizes the emitted `Set-Cookie` header becomes multi-megabyte, which a fronting reverse proxy will reject (nginx's default `proxy_buffer_size` is 4k/8k → 502 rather than a usable error), and the per-request chain `trim()` → `JSON.stringify` → `Buffer.from` → `toString('base64url')` → cookie serialisation allocates several copies of the field, amplifying an unauthenticated request body (the site does not set `bun.maxRequestBodySize`, leaving Bun's 128 MB default).

## Recommendation

Validate the field before minting a token — e.g. `if (username.length > 64) return fail(400, { error: 'Username too long', username: username.slice(0, 64) })` — and consider a charset check. On the client, add `maxlength` to the username input so the constraint is visible in the published template.

## Revalidation

**Verdict:** true-positive

Verified. `username` is `String(formData.get('username') ?? '').trim()` with only an emptiness check (routes.ts:16-20), it is JSON-stringified and base64url-encoded straight into the token (session.ts:19), and `<input name="username" …>` in EnhancedLoginForm.svelte:56 carries no `maxlength`, so the field is unbounded in both the browser and the handler. The arithmetic works out: a ~3000-char username yields a ~3030-byte JSON payload, ~4040 bytes of base64, plus the `.` and the 22-char truncated HMAC and the 20-byte cookie name — right at the ~4096-byte name+value ceiling browsers silently enforce, so a little over 3000 characters is reliably discarded. The action still returns `success({ username })`, and the hydrated island assigns `currentUser = result.data.username` (EnhancedLoginForm.svelte:24-27), so the UI renders 'Signed in as …' for a session that was never stored; the next navigation re-runs `serverProps`, finds no cookie, and shows the login form again. The secondary observations also hold — the site passes no `bun.maxRequestBodySize`, so Bun's large default applies and a multi-megabyte field drives several copies through `trim` → `JSON.stringify` → `Buffer.from` → `toString('base64url')` → cookie serialisation, and the resulting oversized `Set-Cookie` would be rejected upstream rather than surfacing a usable error. Low impact and demo code, but a genuine, verifiable logic flaw in a published login template, which is exactly what BUG severity is for.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
