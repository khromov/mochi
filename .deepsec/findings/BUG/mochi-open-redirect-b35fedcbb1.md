# [BUG] Redirect origin taken from the client-controlled Host header, bypassing the framework's `proxy.origin` pinning

**File:** [`packages/site/src/demos/data-loading/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/data-loading/routes.ts#L5) (lines 5)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `open-redirect`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`Response.redirect(new URL('/demos/data-loading/pikachu', req.url), 302)` builds an absolute `Location` by resolving the path against `req.url`. Under `Bun.serve`, `req.url`'s authority is reconstructed from the inbound `Host` header, so a request with `Host: evil.example` is answered with `Location: http://evil.example/demos/data-loading/pikachu`.

The framework provides exactly the mitigation this skips. `runtime/proxy.ts`'s `buildPublicUrl()` / `resolveExpectedOrigin()` pin the request URL to the configured public origin, and `packages/site/src/index.ts:201` sets `proxy: { origin, addressHeader: 'x-forwarded-for', xffDepth: 1 }` precisely because the socket peer is nginx rather than the visitor. Every framework-managed route therefore gets a Host-independent `event.url` — the site's own `handleError` uses `new URL('/demos/error', event.url)` (index.ts:56), the safe form. This route cannot: because its value is a bare function rather than a `Mochi.page`/`Mochi.api`, `registerRoutePattern` returns `null` and `Mochi.ts:1536` registers it directly into `bunRoutes`, so `buildRequestContext` never runs and no pinned `url` or `event` is available to it. There is no allowlist or host check before the redirect.

Exploitability depends on whether the fronting nginx forwards an arbitrary client `Host` (common with `proxy_set_header Host $http_host`) rather than pinning `server_name`, so I am rating this medium confidence. A victim's browser sends the correct `Host` on a direct click, which rules out plain link phishing; the realistic abuse is cache poisoning of the 302 by a CDN or shared cache keyed on path only — made somewhat more likely here because the bypassed `handle` chain means the site's `noCache` middleware never attaches a `Cache-Control` header to this response (middleware/noCache.ts), unlike every other page and api response on the site.

## Recommendation

Make it a framework-managed route so the pinned origin is available, and redirect relatively. Simplest: replace the bare function with a page whose `serverProps` returns `redirect(302, '/demos/data-loading/pikachu/')` — `runtime/forms.ts`'s `redirect` takes a path, so no origin is involved at all. If a raw Bun route value must stay, build the target from a constant (`new URL(path, PINNED_ORIGIN)`) or emit a root-relative `Location` directly: `new Response(null, { status: 302, headers: { Location: '/demos/data-loading/pikachu/' } })`. Note the current target also omits the trailing slash, so under `trailingSlash: 'always'` it costs visitors a second 308 hop.

## Revalidation

**Verdict:** true-positive

The mechanism is confirmed. A plain function is a legal `MochiRouteValue` (types.ts:104-108, 309), so `registerRoutePattern` matches none of its `isMochiPage/Api/Ws/Sse/File` branches, returns `null` at Mochi.ts:1511, and the caller assigns it verbatim at Mochi.ts:1537 — `buildRequestContext` never runs, so neither `buildPublicUrl()` nor the site's `proxy: { origin, … }` pin (index.ts:201) is applied. `req.url`'s authority under `Bun.serve` does come from the inbound `Host` header — Bun's own changelog records 'Fixed `Request.url` not showing the value from the `Host` header' (bun-v0.3.0) — and the repo's `proxy.ts` docstring says the same thing in different words. `Response.redirect` requires an absolute URL, so the `Location` carries whatever origin `new URL(path, req.url)` resolved. I am downgrading from MEDIUM because the 'open redirect' framing does not hold, as the finding itself concedes: a victim's browser always sends the correct `Host` on a click, so there is no link-phishing vector, and the cache-poisoning variant requires a front-end cache keyed on path only plus an nginx that forwards an arbitrary `Host` — neither is verifiable, since there is no proxy config in this repo at all. What *is* deterministic is narrower: `Mochi.serve()` is called with no `tls`, so behind a TLS-terminating proxy `req.url` is always `http://`, meaning every legitimate visitor to `/demos/data-loading` gets a scheme-downgraded `Location: http://…` plaintext hop (which, combined with F8's missing `Secure`, would carry the path-`/` demo session cookie in the clear) while every framework-managed route on the site emits the pinned `https://` origin. A real defect that the framework explicitly provides a mitigation for and this route bypasses, but the security impact is Host/scheme reflection rather than an exploitable open redirect.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
