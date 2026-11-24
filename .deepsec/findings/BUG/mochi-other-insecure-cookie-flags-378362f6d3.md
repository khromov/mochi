# [BUG] Session cookie set without the Secure attribute on an HTTPS production site

**File:** [`packages/site/src/demos/login/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/login/routes.ts#L25-L30) (lines 25, 26, 27, 28, 29, 30)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-insecure-cookie-flags`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The session cookie is written with `path`, `httpOnly`, `sameSite: 'Lax'` and `maxAge`, but no `secure: true`. `packages/site` is deployed over HTTPS (index.ts:117 resolves `CSRF_PROTOCOL` to `https` when `MOCHI_PORT === 443`) and registers no `cookie:defaults` filter — its only filter is `consoleLogger:line` (index.ts:245-247) — so `MochiCookieJar`'s `defaults` is the empty object produced by `applyFilter('cookie:defaults', {}, …)` (Mochi.ts:494). The resulting `Set-Cookie` therefore carries no `Secure` flag, meaning a network attacker who can get the victim's browser to issue any plaintext `http://mochi.fast/...` request (an injected image/link, DNS/ARP spoofing, hostile Wi-Fi) receives the session token in cleartext. No `Strict-Transport-Security` header is set anywhere in the repo, so there is no HSTS backstop in the application layer. Impact on this site is limited because the demo session authorises nothing beyond rendering a username — but this file is deliberately published as reference material: `files.ts` exposes it at `/demos/login/llms.txt`, and `packages/site/src/SKILL.md:24` instructs code generators to fetch the `login` demo when asked to 'Build a login form'. The repo's own docs show the correct pattern (`packages/docs/162-extensions.md:23,157` → `'cookie:defaults': () => ({ secure: true, httpOnly: true, sameSite: 'Lax', path: '/' })`), which this deployment never applies.

## Recommendation

Add `secure: process.env.NODE_ENV !== 'development'` to the `cookies.set()` options, or (preferably, matching the documented architecture) register a `'cookie:defaults'` filter in `packages/site/src/index.ts` returning `{ secure: true, httpOnly: true, sameSite: 'Lax', path: '/' }` so every cookie the site mints — including the framework's own protection-clearance cookie at Mochi.ts:1789, which has the same omission — inherits the flag.

## Revalidation

**Verdict:** true-positive

The mechanical claim is verified. `cookies.set()` merges `{ ...this.defaults, ...options }` (cookies.ts:95-99); `cookieDefaults` is `applyFilter('cookie:defaults', {}, { options })` (Mochi.ts:494), the site registers only a `consoleLogger:line` filter (index.ts:245-247), so `defaults` is the empty object and the per-call options at routes.ts:25-30 omit `secure` — the emitted `Set-Cookie` carries no `Secure` attribute (cookies.test.ts:108-114 confirms a falsy `secure` produces no `Secure`). No `Strict-Transport-Security` header appears anywhere in the repo, and the repo's own docs prescribe the fix (162-extensions.md:23,157). SKILL.md:24 does point code generators at the `login` demo for 'Build a login form', and `files.ts` publishes `routes.ts` and `session.ts`, so the pattern propagates. I am downgrading from MEDIUM for two reasons. First, the exploitable impact on this deployment is nil: the password is the literal `hunter2` printed on the page itself, and the session authorises nothing beyond rendering a username, so a stolen cookie gets an attacker nothing they could not mint themselves in one POST. Second, the finding's supporting claim is factually wrong — the framework's own protection-clearance cookie does *not* share the omission; Mochi.ts:1790 explicitly sets `secure: url.protocol === 'https:'`. So what remains is a real and verified missing-flag defect in published reference material, correctly judged as a documentation-quality bug rather than a MEDIUM vulnerability.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
