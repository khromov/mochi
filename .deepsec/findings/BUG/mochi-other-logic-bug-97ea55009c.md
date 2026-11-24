# [BUG] api:cookie fixture body does not match the route's expected JSON shape

**File:** [`packages/mochi/scripts/leak/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/scripts/leak/routes.ts#L26-L27) (lines 26, 27)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The fixture posts `JSON.stringify({ name: 'leak-test', value: 'x' })` (L27) to `/api/cookie`. That route destructures a different shape: `const { username, theme } = await request.json()` (`packages/site/src/demos/cookies/routes.ts`), then calls `cookies.set('mochi_username', username, …)` and `cookies.set('mochi_theme', theme, …)`. Both values are therefore `undefined`.

`MochiCookieJar.set` performs no validation (`runtime/cookies.ts:96-100`) and forwards straight to `new Bun.Cookie(name, value)` (`cookies.ts:34`). Depending on how Bun's `Cookie` constructor coerces an `undefined` value, this either silently writes the literal string `undefined` into two `Set-Cookie` headers on every one of roughly 3,750 requests per default run, or throws and yields a 500 from the handler. I did not execute anything to disambiguate, but either outcome is wrong, and the second is fully invisible to the verdict because of the 5xx-blindness in `runLeakTest.ts:167` — so the harness could be 500-ing on an eighth of its traffic and still report PASS.

## Recommendation

Change the fixture body to the shape the route actually reads: `JSON.stringify({ username: 'leak-test', theme: 'dark' })`. Separately, consider validating the payload in the route itself so a malformed body returns a 400 rather than writing `undefined` cookies.

## Revalidation

**Verdict:** true-positive

The core claim is definitively true. The fixture posts `JSON.stringify({ name: 'leak-test', value: 'x' })` (routes.ts:27) while `/api/cookie` destructures `const { username, theme } = (await request.json()) as { username: string; theme: string }` and calls `cookies.set('mochi_username', username, …)` / `cookies.set('mochi_theme', theme, …)` (`packages/site/src/demos/cookies/routes.ts`). Both values are `undefined` at runtime; the `as` cast is why typecheck stays green. CSRF does not block it — `isFormContentType('application/json')` is false (csrf.ts:60-67), so the handler runs. I resolved the ambiguity the finding left open, without executing anything: `MochiCookieJar.set` performs no validation (cookies.ts:96-100) and `serializeCookie` takes the options branch, building a `CookieInit` with `value: undefined` and passing it to `new Bun.Cookie(init)` (cookies.ts:37-56). `bun-types/bun.d.ts:10745-10758` declares `CookieInit.value?: string` as optional, so a missing/undefined value is a supported input rather than a constructor error — the route will not throw and will not 500. The gitignored 2026-05-02 report corroborates this: `api:cookie` shows 3566/0/0/0 (all 2xx). So the finding's second branch ('throws and yields a 500', 'the harness could be 500-ing on an eighth of its traffic') is unsupported and I am explicitly rejecting it; the real outcome is two meaningless `Set-Cookie` headers per request. The defect that remains is real and worth the stated fix: the fixture does not exercise what the README claims ('JSON API + MochiCookieJar' with real values), and the cookie-serialization path it does exercise is the degenerate empty-value one. Confidence 'medium' in the original was appropriate for the consequence; the mismatch itself is high-confidence. BUG — arguably a nit, but the fix is a one-line fixture change.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
