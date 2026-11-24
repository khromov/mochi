# [MEDIUM] Attacker-chosen dimensions on an unauthenticated, synchronous, un-memoized server-side rasterizer stall the whole event loop

**File:** [`packages/site/src/demos/charts/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/charts/routes.ts#L5-L30) (lines 5, 14, 22, 23, 25, 30)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-resource-exhaustion`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`/demos/charts/traffic.png` is a public `Mochi.api` route (no auth; the site's `protection.protect` only matches `/demos/protection*`, and no global `Mochi.serve({ rateLimit })` is configured). `width`/`height` come straight from the query string and are clamped to [64, 2000], so a caller can request a 2000x2000 = 4,000,000-pixel canvas — a 26x pixel amplification over the 640x240 (153,600 px) the demo page's own `<img>` requests (Charts.svelte:200).

The inline comment at line 7 addresses only per-render *memory* and concludes the clamp is sufficient. The unaddressed cost is CPU on a single-threaded runtime: `renderTrafficChart` delegates to layerchart's `renderChart`, which is **fully synchronous** — `node_modules/layerchart/dist/server/index.js` runs `render()` (Svelte SSR), `renderTree()` (full canvas paint) and `canvas.toBuffer('image/png')` with no await, and `serverChart.ts:20-23` types it `=> Uint8Array`, not a Promise. A 4 Mpx Skia paint plus PNG encode therefore blocks Bun's JS thread for the entire render, stalling every other page, API route, WebSocket frame and SSE stream in the process.

There is no server-side cache of rendered output. `Cache-Control: public, max-age=3600` (line 27) is a client/shared-cache directive only, and ~1937 x 1937 distinct (width, height) pairs make it trivial to miss any CDN or nginx cache on every request.

The `{ limit: 60, window: '1m' }` guard is real but was not sized for the worst-case render: it permits one 4 Mpx synchronous render per second per IP, indefinitely. More importantly it is keyed on the client address (`rateLimit.ts:250`, `getClientAddress() ?? 'unknown'`), so it is structurally bypassable without any spoofing — an attacker hosts a page containing `<img src="https://mochi.fast/demos/charts/traffic.png?width=2000&height=2000&h=<random>">`. Every visitor issues the expensive render from their own IP with its own untouched 60/min quota, and the randomized dimensions defeat caching. A modestly-trafficked attacker page keeps the single-threaded process saturated with back-to-back blocking rasterizations, degrading all of mochi.fast rather than just this demo. The route is also a bare `Mochi.api` function, so POST reaches it too.

## Recommendation

Bound the worst case to something close to legitimate use and stop recomputing it: (1) drop `MAX_SIZE` to the largest size the page actually needs (e.g. 1280) or, better, accept only an allowlist of named sizes (`?size=card|hero`) instead of free-form integers, mirroring the `image.sizes` pattern `Mochi.serve()` already uses elsewhere on this site; (2) memoize rendered bytes server-side keyed on `(width, height, format)` so a repeated or cache-busted request is a map hit rather than a fresh paint; (3) add a small in-flight concurrency gate (e.g. at most 1-2 concurrent renders, 503/429 beyond it) so no amount of distributed traffic can occupy the event loop indefinitely; and (4) consider tightening the per-IP window, since the legitimate page issues exactly one request per view.

## Revalidation

**Verdict:** true-positive

Verified end to end. The route is mounted (`packages/site/src/routes.ts:28,355`), is a bare `Mochi.api` with no auth, and `protection.protect` in site/src/index.ts:191 matches only `/demos/protection*`; there is no server-wide `rateLimit` in `Mochi.serve()`. `clampSize` admits [64, 2000], so 2000x2000 = 4,000,000 px against the demo page's own `<img width="640" height="240">` (Charts.svelte:200) = 153,600 px — a 26x pixel amplification, and the inline comment at line 7 addresses only memory. The synchrony claim is correct: `node_modules/layerchart/dist/server/index.js` `renderChart` calls `render()`, forces `void rendered.body`, then `renderCapturedChart` → `createCanvas` → `renderTree(ctx, …)` → `canvas.toBuffer(mimeType)` with no `await` anywhere, and `serverChart.ts` types it `=> Uint8Array`. On Bun's single JS thread that blocks everything. No server-side memoization exists — only the `Bun.build` bundle is cached in `bundle`; bytes are re-rendered every call. `noCache` leaves the route's `public, max-age=3600` intact (it early-returns when `cache-control` is already set), but an extra random query param busts any shared cache. Crucially, I confirmed the bypass is structural rather than requiring spoofing: the limiter keys on `getClientAddress() ?? 'unknown'` (rateLimit.ts:~250) and site/src/index.ts:201 sets `proxy: { addressHeader: 'x-forwarded-for', xffDepth: 1 }`, so the key is each visitor's real IP — a distributed `<img src=…?width=2000&height=2000&h=rand>` on an attacker page gives every visitor a fresh 60/min quota. On magnitude I'd temper the finding slightly: cost is dominated by PNG-encoding a mostly-flat 4 Mpx canvas, order 10²ms rather than seconds, so one IP alone buys a fraction of a core and sustained saturation needs the distributed variant. The `src/demos/*` known-false-positive carve-out does not cover this: it is about auth/secrets demo patterns (hardcoded `hunter2`, no auth), and commit 1289d8f8 ('bound unbounded resource growth on public demo routes') shows resource exhaustion on exactly this file is treated as a product concern. MEDIUM stands as residual risk after that hardening.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-06)
