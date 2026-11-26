# [MEDIUM] getRequestContext() in a Handle throws on unmatched URLs under /demos/mode-watcher*, leaking a stack trace and bypassing the error pipeline

**File:** [`packages/site/src/demos/mode-watcher/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/mode-watcher/routes.ts#L14-L17) (lines 14, 17)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-info-disclosure`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The middleware calls `getRequestContext()` (line 17) after only a prefix check (line 14). Mochi establishes the AsyncLocalStorage request context *inside* the matched-route handlers (`Mochi.ts:977`/`991` for pages, `1207`/`1240` for APIs), but the non-route path — `composedFetch`, which serves framework assets, the `fetch` fallback, and 404s — invokes user middleware with no context active (`Mochi.ts:1876-1922`, no `requestContext.run`). The framework itself acknowledges this: `runtime/errors.ts:44` guards with `if (requestContext.getStore())` before rendering an error page on that path. `getRequestContext()` throws when `getStore()` is undefined (`runtime/requestContext.ts:181-188`).

Because the guard is `startsWith('/demos/mode-watcher')` and `packages/site` registers no wildcard route and no `fetch` fallback, every unmatched URL under that prefix (e.g. `/demos/mode-watcher/x`, `/demos/mode-watcher/favicon.ico`, `/demos/mode-watcherX`) falls through to `composedFetch`, hits line 17 and throws. No cookie is required — the throw happens before the cookie is even compared.

Impact: Mochi passes no `error` handler to `Bun.serve` (`Mochi.ts:2020-2026`), so the rejection surfaces through Bun's default handling. Bun's `development` flag defaults to `process.env.NODE_ENV !== 'production'` and, when on, "returns rendered error messages with stack traces instead of a generic 500 error" (bun-types/serve.d.ts:848-851, 1303-1309). The deployed site image runs `ENTRYPOINT bun run dev:site` → `NODE_ENV=development bun src/index.ts` (`Dockerfile:5`/`:80`, `packages/site/package.json:14`), so an unauthenticated `GET https://mochi.fast/demos/mode-watcher/anything` returns Bun's contextual error page with the error message and a JS stack trace (framework file paths and internal structure) instead of the site's 404 page.

Secondary breakage on the same code path: the throw escapes before `mochiEvents.emit('request', …)` (Mochi.ts:1923), so the configured `handleError` hook, request logging, `analytics()`, and `compress()` post-processing are all skipped, and a 404 is served as a 500. `packages/site/src/demoLlms.test.ts` boots `Mochi.serve()` without `handle`, so no test covers the middleware chain. This is the only `getRequestContext()` call inside a `Handle` anywhere in the site — every other use is inside a route handler or `serverProps`, where the context exists.

## Recommendation

Don't read the request context from a `Handle` that can run for non-route requests. Read the cookie off the event instead — e.g. parse `event.request.headers.get('cookie')` for `mochi-demo-theme` — which works on every path. If `getRequestContext()` must be used, narrow the guard to the demo's exact canonical paths and require `event.kind === 'page'` (both `'asset'`/`'fallback'`/`'error'` and any unmatched sub-path otherwise reach it), and wrap the read in a try/catch as a backstop. Separately, replace the `startsWith` prefix test with exact-path matching so `/demos/mode-watcher-*` URLs aren't captured, and consider adding a site test that boots `Mochi.serve()` with the real `handle` sequence and asserts a 404 (not a 500) for an unmatched path under each handle's prefix.

## Revalidation

**Verdict:** true-positive

I verified every link in this chain. `composedFetch` (Mochi.ts L1863-1935) builds its `MochiEvent` and calls `middleware({ event, resolve: innerResolve })` at L1922 with **no** `requestContext.run` anywhere on that path and no try/catch around it — contrast the page path at L977 and the api path at L1207, which both wrap `middleware` inside `requestContext.run(ctx, …)`. `getRequestContext()` throws when `getStore()` is undefined (runtime/requestContext.ts L183-187), and `assertServerOnly` is a no-op on the server (utils/serverOnly.ts L16-20), so nothing short-circuits the throw. The site's handle chain is `sequence(compress, immutableAssets, helloWorld, asciiDog, analytics, encodeDebugBarPaths, noCache, cookieVaryTestHandle, modeWatcherHandle, shotHandle)`; `sequence` (runtime/hooks.ts L102-131) has no try/catch, nor do `compress`/`noCache`/`analytics`/the site's own handles, so the rejection escapes `composedFetch`. I confirmed there is no catch-all: the only wildcard pattern in the whole site is `/og/*`, `options.fetch` is unset, and no `public/` file sits under that prefix — so `/demos/mode-watcher/x`, `/demos/mode-watcher/favicon.ico` and `/demos/mode-watcherX` are all unmatched and hit line 17 after only the `startsWith` test at line 14, before any cookie comparison. `Bun.serve()` at Mochi.ts L2020-2026 receives no `error` handler (and `options.development` is never injected into `bunOptions` — L479 computes a local only), so Bun's own default applies: the vendored types in this repo state `development` defaults to `process.env.NODE_ENV !== 'production'` and that development mode 'returns rendered error messages with stack traces instead of a generic 500 error' (bun-types/serve.d.ts L848-851, L1303-1309). The site image is built from `Dockerfile` per `.github/workflows/build.yml` (`site` leg, `dockerfile: Dockerfile`), whose ENTRYPOINT is `bun run dev:site` → `NODE_ENV=development bun src/index.ts`. So a single unauthenticated GET yields a 500 with a stack trace instead of the site 404, and skips `handleError`, the `request` event, `analytics()` and `compress()`. `demoLlms.test.ts` boots `Mochi.serve()` with `routes`/`queues` only and no `handle`, so nothing covers this. Keeping MEDIUM: trivially reachable, no preconditions, and it is the only route on the site that leaks a raw framework stack trace — a site that otherwise goes out of its way to scrub file paths (`encodeDebugBarPaths`).

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-07)
