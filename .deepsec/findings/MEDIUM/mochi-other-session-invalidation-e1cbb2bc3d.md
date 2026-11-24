# [MEDIUM] cookies.delete() drops secure/partitioned from the resolved defaults, so __Host-/__Secure-/Partitioned cookies are never actually cleared

**File:** [`packages/mochi/src/runtime/cookies.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/runtime/cookies.ts#L102-L113) (lines 102, 104, 107, 108, 109, 110, 111, 112, 113)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-session-invalidation`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`delete()` rebuilds the serialize options as `{ path: defaults.path, domain: defaults.domain, ...options, maxAge: 0 }` (L107-113), deliberately carrying `path`/`domain` across — the comment shows the author reasoning about browser matching — but it drops every other default, including the two attributes a browser requires in order to *accept* the deletion at all:

1. **`secure`** — RFC 6265bis §4.1.3 cookie prefixes: a `Set-Cookie` for a `__Secure-`/`__Host-` prefixed name without the `Secure` attribute is rejected outright by every major browser. So with the standard hardening `cookieDefaults: { secure: true, httpOnly: true, path: '/' }` and a cookie named `__Host-session`, `cookies.delete('__Host-session')` emits `__Host-session=; Path=/; Max-Age=0` with no `Secure` → the browser discards the header and the session cookie survives.
2. **`partitioned`** — a CHIPS partitioned cookie is stored under a partition key; an unpartitioned `Set-Cookie` of the same name does not clear it. This is not hypothetical for this repo: `packages/support` serves the newsletter widget inside a cross-origin iframe on `packages/site`, which is precisely the CHIPS use case.

The failure is silent and actively misleading, because L104 also does `this.parsed.delete(name)` — server-side code in the same request (and the debug bar) sees the cookie as gone while the browser keeps sending it on every subsequent request. For an application logout handler this means the session cookie is never invalidated client-side. `cookies.test.ts` covers only the path/domain inheritance case (L116), so nothing catches this.

## Recommendation

Spread the full resolved defaults in `delete()` and override only the expiry — `serializeCookie(name, '', { ...this.defaults, ...options, maxAge: 0 })` — so `secure`, `partitioned` and `sameSite` ride along. Add tests asserting that deleting a `__Host-`-prefixed cookie emits `Secure`, and that a partitioned default produces `Partitioned` on the deletion header.

## Revalidation

**Verdict:** true-positive

Verified end-to-end. `delete()` (cookies.ts:107-113) builds the serialize options as `{ path: defaults.path, domain: defaults.domain, ...options, maxAge: 0 }`, so `secure`, `partitioned`, `sameSite`, `httpOnly` and `priority` from the resolved `cookieDefaults` are all dropped. `serializeCookie` only sets `init.secure = options.secure`, and Bun's own types/docs confirm the defaults: `node_modules/bun-types/bun.d.ts:10745-10758` documents `path` defaulting to `/` and `sameSite` to `lax`, and `new Bun.Cookie('name','value').toString()` is documented as `"name=value; Path=/; SameSite=Lax"` — i.e. no `Secure`, no `Partitioned`. The repo's own test suite proves the attribute is omitted when the flag is falsy (cookies.test.ts: `jar.set('session','abc',{secure:false})` → `not.toContain('Secure')`), so the deletion header is `__Host-session=; Path=/; SameSite=Lax; Max-Age=0`. RFC 6265bis's cookie-prefix rules require a UA to ignore a `Set-Cookie` for a `__Secure-`/`__Host-` name whose secure-only-flag is false, so that header is discarded and the session cookie survives — while L104's `this.parsed.delete(name)` makes the server (and the debug bar) believe it is gone. The API offers no escape hatch: `delete`'s options are typed `Pick<CookieSerializeOptions,'path'|'domain'>`, so a caller cannot pass `secure: true` through it and must fall back to `set(name,'',{maxAge:0,secure:true})`. The CHIPS half is also correct — an unpartitioned `Set-Cookie` does not evict a cookie stored under a partition key, and is itself rejected outright in a third-party context when 3P cookies are blocked. Confirmed as a framework-API defect; blast radius is limited to consumers using prefixed or partitioned cookies (I grepped: no `__Host-`/`__Secure-`/`partitioned` usage anywhere in this monorepo, so no in-repo app is currently broken), and the only existing `delete()` test asserts path/domain only. MEDIUM is appropriate: failed logout/session-invalidation for apps that follow the recommended prefix hardening.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-27)
