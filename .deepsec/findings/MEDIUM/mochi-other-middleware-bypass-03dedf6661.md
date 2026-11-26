# [MEDIUM] publicDir files are raw Bun static routes, so `handle` middleware (auth, security headers) never runs for them — contradicting the docs

**File:** [`packages/mochi/src/Mochi.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/Mochi.ts#L1831-L1859) (lines 1831, 1859)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-middleware-bypass`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`registerPublicRoutes(bunRoutes, initialPublicFiles, publicRouteGuard)` (L1859) installs each discovered public file as a route value. Unless `protection.protectFiles` produced a `publicRouteGuard`, `runtime/publicDir.ts:104` assigns a bare `Bun.file(diskPath)`, which Bun serves natively: the request never enters `composedFetch`, so `handle` middleware, `filterResponseHeaders`, rate limiting, the CSRF check and the `request` event are all skipped for every `/public/**` URL.

Two doc statements tell users the opposite, and both are security-relevant:
- `160-serve-options.md:33`: "Public-dir files ... keep Bun's default static-route headers. **To override, mutate `response.headers` in a `handle` middleware.**" — a middleware that adds CSP / `X-Frame-Options` / `Strict-Transport-Security` (or a `noCache`/`compress` layer) silently does not apply to any public file.
- `160-serve-options.md:109`, warning that `staticDirs` mounts bypass the pipeline, directs readers to the alternative: "If you need any of that — **auth**, custom headers, logging — serve those files through `publicDir` ... or your own `Mochi.api` / `Mochi.file` route instead." An operator following that advice and relying on middleware to gate a file in `publicDir` gets no gate at all.

(By contrast, `Mochi.file()` middleware-exemption is correctly documented at `40-defining-routes.md:217`, and `staticDirs` at :109 — so this is specifically a publicDir gap.)

## Recommendation

Either register public files as handler routes that run the `handle` chain (an `event.kind === 'asset'`/`'file'` event, as `composedFetch` already does for framework bundles) — the `publicRouteGuard` path already proves a handler route works here — or correct both doc statements to say that `publicDir` files bypass middleware, and remove the recommendation to use `publicDir` when auth or custom headers are needed.

## Revalidation

**Verdict:** true-positive

Both halves verified. runtime/publicDir.ts:95-104 assigns `routes[routeKey] = Bun.file(diskPath)` whenever no `publicRouteGuard` is present — a static Bun route value, served natively by the router, so the request never enters `composedFetch`. Since `handle`, `filterResponseHeaders`, the CSRF check, the rate limiter and the `request` event all live inside `composedFetch`/`buildRequestContext`, none of them run for any `/public/**` URL. A `publicRouteGuard` exists only when `protection.protectFiles` is on (Mochi.ts:1845-1858), and the framework's own comment at 1843 confirms the design intent ('publicDir files bypass buildRequestContext (they're raw Bun routes), so protection reaches them through this guard'). The documentation is what makes this security-relevant rather than merely surprising: docs/160-serve-options.md:33 states public-dir files 'keep Bun's default static-route headers. To override, mutate `response.headers` in a `handle` middleware' — a middleware adding CSP/HSTS/X-Frame-Options to static files silently does nothing — and the staticDirs warning at :109 redirects readers wanting 'auth, custom headers, logging' to `publicDir`, where only the protection guard (not auth middleware, not logging) actually applies. By contrast `Mochi.file()` and `staticDirs` middleware-exemption are both correctly documented, so this is specifically a publicDir doc gap. Keeping MEDIUM: the framework behavior is intentional, but an operator following the written instructions gets a silently ungated/unheadered path, which is a real misconfiguration vector.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-11-14)
