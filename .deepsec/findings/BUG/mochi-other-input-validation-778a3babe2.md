# [BUG] /api/cookie casts request.json() without validation and writes it straight into Set-Cookie, 500ing on ordinary input

**File:** [`packages/site/src/demos/cookies/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/cookies/routes.ts#L10-L15) (lines 10, 15)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-input-validation`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The handler does `const { username, theme } = (await request.json()) as { username: string; theme: string }` — a TypeScript cast, not a runtime check — and passes both values directly to `cookies.set()`. Three reachable failure modes, all ending in an uncaught throw that `Mochi.ts:1228` converts into a 500:

1. **Non-object body.** An empty body or invalid JSON rejects inside `request.json()`; a body of literal `null` makes the destructure throw `TypeError`.
2. **Missing or non-string fields.** `{}` or `{"username": 42}` hands `undefined`/a number to `MochiCookieJar.set` → `new Bun.Cookie({ value: undefined })`, which either throws or persists the literal string `undefined` for 7 days.
3. **Values containing a cookie separator.** `MochiCookieJar.set` delegates to `Bun.Cookie`, which rejects control characters and separators — the repo states this itself in `packages/mochi/src/runtime/cookies.fuzz.test.ts:9` ("set() delegates to Bun.Cookie, which rejects control chars / separators"), which is why that fuzzer restricts its alphabet to `[a-zA-Z0-9_]`. So a visitor typing `mochi fan` (a space) into the demo's own free-text Username box and pressing "Set via API" gets a 500. The island's `setCookieViaApi` then parses the error envelope, finds no `ok`, and shows nothing (`CookieDemo.svelte:24-27`) — a silently dead button. The "Set via Client" button accepts the identical input, because js-cookie percent-encodes it.

No security impact: `Mochi.ts:743` redacts the message to 'Internal Server Error' outside development, and the route is same-origin-only (see the CSRF analysis), so the unbounded value length is at worst a self-inflicted cookie bomb. But this is published documentation — `packages/docs/85-request-context.md:66` points readers at this demo — so it both breaks for normal input and models casting an untrusted JSON body straight into a response header.

## Recommendation

Validate before writing: reject a non-object body with `error(400, …)`, require `typeof username === 'string' && typeof theme === 'string'`, cap the length (e.g. 64 chars), constrain `theme` to the select's own allowlist (`light|dark|auto`), and restrict `username` to a cookie-safe charset (or `encodeURIComponent` it) so `Bun.Cookie` can never throw. Wrap the `cookies.set` pair in a try/catch returning 400 as a backstop.

## Revalidation

**Verdict:** true-positive

The thesis is real but the headline and the most load-bearing sub-claim are wrong, so I am confirming this with materially narrowed scope. CONFIRMED: there is no runtime validation — `(await request.json()) as { username: string; theme: string }` is a pure TypeScript cast — and failure mode 1 is genuine. An empty body or malformed JSON rejects inside `request.json()`, and a body of literal `null` makes the destructure throw TypeError; either way the throw escapes the handler into the api catch block (Mochi.ts:1226-1235), which logs and returns `apiError(500, 'Internal Server Error')`. So a malformed POST gets a 500 where a 400 belongs. REFUTED: failure mode 3, the claim the title rests on. I read Bun's Cookie implementation at the pinned version (tags bun-v1.4.4 and bun-v1.4.5, byte-identical to main): `Cookie::create()` validates only name, path and domain (src/jsc/bindings/Cookie.cpp:43-52 and the CookieInit overload in Cookie.h:45-58) and never touches the value, while `Cookie::appendTo()` percent-encodes it with `encodeURIComponent` (Cookie.cpp:242). Bun's own test suite asserts this — `new Bun.Cookie("a", '\"'.repeat(…))` is annotated "Each quote becomes %22" in test/js/bun/cookie/cookie.test.ts. The framework takes the options path (cookieDefaults is `{}`, Mochi.ts:494, merged with `{path:'/', maxAge:604800}`), so `new Bun.Cookie(init).serialize()` emits `mochi_username=mochi%20fan; Path=/; Max-Age=604800; SameSite=Lax` — HTTP 200, no throw, button works. The finding's cited evidence, cookies.fuzz.test.ts:9, conflates cookie-NAME validation (`isValidCookieName` does reject space, `;` and `=`) with value handling; the fuzzer restricts both to `[a-zA-Z0-9_]`, which is why nothing caught the conflation. PARTLY WRONG: failure mode 2's "either throws" half is impossible for the same reason; the surviving half is right — `{}` or `{"username":42}` silently persists an empty or number-coerced cookie for 7 days. So: keep BUG for the unvalidated-body-to-Set-Cookie pattern in published documentation and the 500-on-malformed-body path, but the "500s on ordinary input / silently dead button" narrative does not happen.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
