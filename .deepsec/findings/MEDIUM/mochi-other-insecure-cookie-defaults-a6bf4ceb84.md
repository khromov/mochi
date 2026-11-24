# [MEDIUM] Client half of the isomorphic `cookies` API silently drops the app's `cookie:defaults` (Secure / SameSite / path)

**File:** [`packages/mochi/src/compiler/virtual-modules/mochi-env.client.js`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/compiler/virtual-modules/mochi-env.client.js#L11-L20) (lines 11, 14, 20)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-insecure-cookie-defaults`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

This file wires the public `cookies` export for client bundles to `createClientCookies()` (`packages/mochi/src/runtime/cookies.client.ts`), which forwards only the per-call options to the vendored js-cookie: `Cookies.set(name, value, options ? { ...options } : undefined)`. The app's configured defaults are never consulted — they cannot be, since they are resolved on the server at startup (`packages/mochi/src/Mochi.ts:494`, `applyFilter('cookie:defaults', {}, { options })`) and are not serialized into the page.

The server half does apply them: `MochiCookieJar.set()` does `serializeCookie(name, value, { ...this.defaults, ...options })` (`packages/mochi/src/runtime/cookies.ts`), with `this.defaults` coming from that filter.

Both halves are documented as one API, which is what makes the divergence a defect rather than a design choice:
- `packages/docs/85-request-context.md:66`: "Read and write cookies on the server and the client through one API."
- `packages/docs/85-request-context.md:109`: "`url` and `cookies` work on the server and the client."
- `packages/docs/162-extensions.md:150-152`: `cookie:defaults` is "Default `CookieSerializeOptions` merged into **every** `cookies.set()` call", with the example value `{ secure: true, httpOnly: true, sameSite: 'Lax', path: '/' }`.

The vendored js-cookie's only default is `path: '/'` — `const api = init(defaultConverter, { path: '/' })` at the end of `packages/mochi/src/vendor/js-cookie/index.ts`. So an app that centrally enforces `secure: true` gets that attribute on the server and silently loses it for any cookie an island writes after hydration: the cookie is then transmitted over plaintext HTTP on any downgrade and is writable by an active network attacker on an `http://` origin. `sameSite` is likewise dropped (largely absorbed by modern browsers' Lax-by-default, but not guaranteed). `httpOnly` is inherently impossible from `document.cookie` and is a documentation gap rather than a code bug.

The same divergence breaks deletion: the server's `delete()` deliberately replays `this.defaults.path`/`domain` (with the comment "otherwise the browser won't match the original Set-Cookie and the cookie won't be deleted"), while the client's `delete()` falls back to js-cookie's `path: '/'`. With a configured `path: '/app'`, a client-side `cookies.delete()` therefore issues a non-matching expiry and leaves the cookie in place.

## Recommendation

Serialize the client-relevant subset of the resolved `cookie:defaults` (`path`, `domain`, `secure`, `sameSite`, `partitioned`, `priority`) into the page alongside `window.__mochi_log_level`, and have `createClientCookies()` merge them under the per-call options — mirroring `MochiCookieJar.set`'s `{ ...defaults, ...options }` precedence — and replay `path`/`domain` in `delete()` as the server does. At minimum, document in `85-request-context.md` and `162-extensions.md` that `cookie:defaults` applies only to server-side writes and that `httpOnly` can never apply client-side.

## Revalidation

**Verdict:** true-positive

Every mechanical claim verified. `packages/mochi/src/runtime/cookies.client.ts:20` is exactly `Cookies.set(name, value, options ? { ...options } : undefined)` — only per-call options are forwarded. The server half at `cookies.ts:99` does `serializeCookie(name, value, { ...this.defaults, ...options })`, with `this.defaults` coming from `applyFilter('cookie:defaults', {}, { options })` at `Mochi.ts:494`. I traced `cookieDefaults` through every reference in the framework (Mochi.ts:735/776/1848/1899, requestSetup.ts:128, errors.ts:54) and it is only ever fed into a `MochiCookieJar` constructor — it is never serialized into the page, unlike `window.__mochi_log_level` (Mochi.ts:315), so the client genuinely cannot see it. The vendored js-cookie's sole default is `init(defaultConverter, { path: '/' })` (vendor/js-cookie/index.ts:154), and `remove()` delegates to `set()`, which merges `defaultAttributes` first — so a client-side `cookies.delete('x')` always writes `Path=/`. The doc contract is broken as cited: `162-extensions.md:152` says the defaults are merged into *every* `cookies.set()` call with no server-only caveat, and `85-request-context.md:66,109` present cookies as one isomorphic API; `mochi-framework.d.ts:35-39` likewise types a single `CookieJar`. The most demonstrable consequence is functional, not cryptographic: with a configured `path: '/app'`, a server `set` emits `Path=/app` while a client `delete` emits a `Path=/` expiry that cannot match, so the cookie survives, and a client `set` creates a second same-name cookie scoped to `/`. The security consequence (a centrally-enforced `secure: true` silently absent on island-written cookies) is real but conditional — it needs a downstream app to opt into the filter AND a plaintext path to the host; `httpOnly` is inherently impossible from `document.cookie` and `sameSite` is largely absorbed by Lax-by-default. No workspace in this repo configures `cookie:defaults` (only `extensions.test.ts` does), so the exposure is to downstream `mochi-framework` consumers rather than mochi.fast. Keeping MEDIUM: a published framework silently voiding a security attribute it documents as universal warrants a security label even though the window is narrow.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-11-13)
