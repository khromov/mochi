---
title: 'Serve options'
slug: serve-options
ogTitle: 'Every Mochi.serve() option'
description: 'Reference for every configuration option on Mochi.serve().'
---

<script>
  import Callout from './_components/Callout.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Serve options

`Mochi.serve(options)` boots the Bun server and registers routes. Pass one `MochiServeOptions` object. Every field is optional except `routes`.

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  port: 3333,
  routes: {
    '/': Mochi.page('./src/Home.svelte'),
  },
});
```

Response compression is opt-in through the [`compress()` middleware](/docs/middleware/#compress).

### Asset caching

In production (`development: false`), prebuilt JS/CSS bundles served from `assetPrefix` (default `/_mochi`) get `Cache-Control: public, max-age=31536000, immutable`. Filenames are content-hashed, so any change yields a new URL. In development the header is omitted so live-reload edits are not pinned in the browser cache. Public-dir files (`./public/...`) are read from `publicDir` on disk in both modes and keep Bun's default static-route headers. To override, mutate `response.headers` in a `handle` middleware.

<Callout type="warning">

**One `serve()` call per process.** To run multiple sites, spawn separate processes on different ports. A second call in the same process throws `Mochi.serve() has already been called.`

</Callout>

<Callout type="info">

**Shutdown signals.** `Mochi.serve()` installs `SIGTERM` and `SIGINT` listeners that fire the [`mochi:shutdown`](/docs/extensions/#mochishutdown) hook, drain queues, then stop the server and exit with code 0. In-flight requests get `shutdownTimeout` ms to finish. Anything still connected is force-closed. A second signal exits immediately with code 1. An open WebSocket never drains, so shutdown waits the full `shutdownTimeout` before force-closing. Keep the timeout tight enough for your orchestrator's grace period. A finite-lifetime embedder (script, test) can run the same teardown without exiting via [`Mochi.stop()`](/docs/queues/#mochistop).

</Callout>

### Options reference

- `port` — TCP port. No default, so set it explicitly.
- `hostname` — interface to bind. Defaults to Bun's default (`0.0.0.0`).
- `development` — enables live reload, debug bar, and dev error overlay. Default: `true`.
- `liveReload` — enable the dev-mode live-reload WebSocket. Default: matches `development`. Set `false` to keep the debug bar but skip the socket.
- `shutdownTimeout` — grace period (ms) for in-flight requests on `SIGTERM`/`SIGINT`. Default: `5000` in production, `0` in development.
- `routes` — `Record<string, MochiRouteValue>` of route paths to `Mochi.page` / `Mochi.api` / `Mochi.ws` / `Mochi.sse`.
- `fetch` — `(req, server) => Response` fallback when no route matches. Default: built-in 404.
- `manifest` — path to a prebuilt manifest JSON. Default: `<outDir>/manifest.json`.
- `htmlShell` — path to an `.html` template or an inline string. Default: built-in shell. See [Custom HTML shell](/docs/custom-html-shell/).
- `handle` — a `Handle` (or `sequence(...)`) wrapping every request. See [Middleware](/docs/middleware/).
- `errorPage` — component rendered for uncaught page errors and unmatched routes. Default: built-in. See [Error handling](/docs/error-handling/).
- `handleError` — `HandleError` hook run before the error page renders. See [Error handling](/docs/error-handling/).
- `compressServerIslandProps` — deflate server-island props when it reduces size. Default: `true`.
- `inlineNestedIslands` — render nested `mochi:defer` islands in-process during an island fetch instead of emitting more client fetches. `mochi:defer:visible` children keep their own fetch; one call site opts out with `mochi:defer={{ inline: false }}`. Default: `true`. See [Server islands](/docs/server-islands/).
- `logger` — built-in request logger. Default: `{ enabled: true }`.
- `publicDir` — directory served as static assets. Default: `./public`. Scanned from disk at startup in every mode, so it must ship with a production deploy.
- `staticDirs` — extra directory trees mounted under a URL prefix. See [Static directories](#static-directories).
- `memoryPressure` — drain in-memory caches when the OS reports low memory. Default: `true`; always off in development. See [Cache](/docs/cache/#memory-pressure).
- `cron` — durable scheduled jobs to start with the server, from `Mochi.cron(name, schedule, handler)`. See [Scheduled jobs](/docs/scheduled-jobs/).
- `cronStorage` — where the cron scheduler stores schedules and jobs. Defaults to `memory`. See [Scheduled jobs](/docs/scheduled-jobs/#storage).
- `outDir` — base directory for build artifacts and dev cache. Default: `./.mochi`.
- `assetPrefix` — URL prefix for framework client assets and the server-island endpoint. Must start with `/`, must not be `/` or end with `/`. Default: `/_mochi`.
- `additionalWatchPaths` — extra dev-mode watcher paths added to `src` and `public`. Default: `[]`.
- `barrelWarnings` — warn when a dependency drags a large, tree-shaken module into the build graph. Default: enabled. See [Development mode](/docs/development-mode/).
- `build` — output controls for `mochi-framework build`. The runtime ignores it. See [CLI](/docs/cli/).
- `svelteConfigPath` — path to a Svelte config file. Default: `./svelte.config.js`. See [Svelte config](/docs/svelte-config/).
- `svelteCompiler` — which compiler emits component JS. Default: `'svelte'`. `'rsvelte'` needs `@mochi-framework/rsvelte`. See [rsvelte](/docs/rsvelte/).
- `optimize` — run the whole-program svelte-shaker pass over `.svelte` source before compiling, so the compiler emits less code. **Production only**, and needs `@mochi-framework/svelte-shaker`. `true` shakes everything; `{ enabled, exclude }` gives finer control. Default: `false`. See [Svelte Shaker](/docs/svelte-shaker/).
- `minifier` (since 0.10.0) — which minifier prints the client JS. `'oxc'` (experimental) runs a second oxc pass over the chunks Bun emitted and needs `oxc-minify`. Default: `'bun'`. See [Production builds](/docs/production-builds/#javascript-minifier).
- `protection` — Cloudflare-style browser verification: unverified clients get an interstitial that auto-solves the captcha proof-of-work and redeems it for a signed clearance cookie. Default: disabled. See [Protection Mode](/docs/protection/).
- `csrf` — `MochiCsrfOptions` for the origin-header check. See below.
- `proxy` — `MochiProxyOptions` for trusted reverse-proxy headers. See below.
- `securityHeaders` (since 0.10.0) — baseline security headers on every framework response: `nosniff` and `Referrer-Policy` by default, `X-Frame-Options` opt-in. `boolean | MochiSecurityHeadersOptions`. Default: on. See [Security](/docs/security/).
- `csp` (since 0.10.0) — mint a per-request nonce and stamp it on every script Mochi emits, for a nonce-based `Content-Security-Policy`. Default: `false`. See [Content-Security-Policy nonce](#content-security-policy-nonce).
- `hooks` / `filters` — named lifecycle hooks and value filters. See [Extensions](/docs/extensions/).
- `warmup` — warm the SSR pipeline at startup by invoking every static page route once. `boolean | { enabledInProd, enabledInDev }`. Default: `false`. See below.
- `bun` — escape hatch for raw `Bun.serve()` options Mochi does not surface — `idleTimeout`, `maxRequestBodySize`, `reusePort`, `tls`. `fetch` / `websocket` / `routes` / `error` are framework-owned and throw if set. See below.

<Callout type="info">

**Sync `assetPrefix` between build and runtime.** When using a prebuilt manifest, pass `assetPrefix` to the `build()` call (or `--asset-prefix`) so the baked-in URLs match. The manifest's URLs take precedence at runtime if the two disagree.

</Callout>

### Static directories

<VersionNote since="0.10.0" message="staticDirs ships in the next Mochi release (0.10.0). This section describes the upcoming API." />

Mount a directory tree under a URL prefix. Each entry becomes one wildcard route that streams files from disk, so a large tree costs one route rather than one per file. Responses carry `Content-Type`, `ETag` and `Last-Modified`, answer `Range` and `If-None-Match` / `If-Modified-Since`, and a directory URL serves its `index.html`.

```ts
// file: src/index.ts
await Mochi.serve({
  staticDirs: { '/assets': './media' },
  routes,
});
```

This is for **large or generated** trees — a media library, a docs export, a build directory from another tool. For ordinary site assets keep using `publicDir`, which scans and registers each file individually.

Like `publicDir`, a mount does not serve dotfiles or dot-directories (`.env`, `.git/…`), apart from a top-level `.well-known/`. The check runs on every request, so it covers files added after startup and every URL spelling of a name. A symlink is followed only while it stays inside the directory and does not resolve to a dot entry.

<Callout type="warning">

A mount is a raw Bun route, matched **before** Mochi's request pipeline — so your middleware never sees it. `handle` hooks, `filterResponseHeaders`, `transformPage`, rate limiting, CSRF, trailing-slash normalization and the `request` event all skip `/prefix/*`, and a miss returns a bare 404 rather than your `errorPage`. If you need any of that — auth, custom headers, logging — serve those files through `publicDir` (which can be gated with `protection.protectFiles`) or your own `Mochi.api` / `Mochi.file` route instead.

</Callout>

### Raw Bun.serve options

`bun` is spread straight into the underlying `Bun.serve()`, so any option Mochi doesn't expose is reachable through it:

```ts
Mochi.serve({
  port: 3333,
  routes,
  bun: {
    idleTimeout: 30, // seconds; HTTP default is 10, max 255, 0 disables
    maxRequestBodySize: 1024 * 1024 * 256,
  },
});
```

Bun times a connection out after `idleTimeout` seconds of inactivity, so a response that stays quiet for longer than the default 10 seconds dies with `request timed out after 10 seconds`. Mochi already disables the idle timer for page renders and SSE streams (`Mochi.sse`), so raising it mainly matters for quiet or long-lived `Mochi.api` responses (chunked streams) and slow request bodies.

<Callout type="info">

`fetch`, `websocket`, `routes`, and `error` are owned by the framework — setting them under `bun` throws at startup. Use the top-level `Mochi.serve()` options instead. To lift the timeout for one route without raising the global value, call `server.timeout(request, seconds)` (seconds, or `0` to disable) inside the handler — the `server` and `request` are on the API event.

</Callout>

### Route warmup

The render pipeline stays cold until a route is first visited, so the first request to each page pays a one-time penalty. Set `warmup: true` to invoke every static page route once, in the background, right after the server starts listening:

```ts
await Mochi.serve({
  warmup: true, // warms in production only
  routes,
});
```

`warmup: true` warms in **production only**. For per-mode control, pass an object:

```ts
await Mochi.serve({
  warmup: { enabledInProd: true, enabledInDev: false },
  routes,
});
```

Warmup is fire-and-forget. The server accepts real traffic immediately, and a [`warmup:complete`](/docs/events/) event fires when the batch finishes. Warmup requests carry `warmup: true` on their `request` event and log under a `WARM` label. Routes with parameter segments (`/docs/:slug`) and `*` catch-alls are skipped, since they have no single canonical URL.

Detect warmup hits with `event.isWarmup` (in [middleware](/docs/middleware/)) and `getRequestContext().isWarmup` (in `serverProps`, components, API handlers) to skip side effects that should not fire for synthetic traffic:

```ts
const analytics: Handle = async ({ event, resolve }) => {
  if (!event.isWarmup) track(event.url.pathname); // skip warmup hits
  return resolve(event);
};
```

### CSRF

`csrf` gates state-mutating form submissions (`POST`/`PUT`/`PATCH`/`DELETE` with a form content type) against an origin-header check. The request's `Origin` must match the expected origin or appear in `csrf.trustedOrigins`. JSON endpoints rely on the browser's CORS preflight and are not checked.

- `checkOrigin` — compare `Origin` against the resolved expected origin. Default: `true`.
- `trustedOrigins` — extra origins to allow. Default: `[]`.

```ts
await Mochi.serve({
  proxy: { origin: 'https://app.example.com' },
  csrf: { trustedOrigins: ['https://embed.partner.com'] },
  routes,
});
```

In production, the check refuses every form mutation until `proxy.origin` (or `proxy.hostHeader`) is set, so the deployment break is loud. In development the request is allowed through with a `[mochi]` warning. Routes declaring form `actions` without either option also warn once at boot — in both modes — so the misconfiguration is visible before deploy, not first discovered as a production 403. So does `proxy.hostHeader` without `proxy.protocolHeader`: the expected origin then keeps the server's own `http://` protocol, which never matches the browser's `https://` origin behind a TLS-terminating proxy.

### Proxy

`proxy` tells the framework how to recover the public origin (for the CSRF check) and the real client IP (for `getClientAddress()`) from forwarded headers.

- `origin` — explicit public origin. Wins over the header options.
- `protocolHeader` — forwarded-protocol header (`'x-forwarded-proto'`).
- `hostHeader` — forwarded-host header (`'x-forwarded-host'`).
- `portHeader` — forwarded-port header (`'x-forwarded-port'`).
- `addressHeader` — forwarded client-IP header (`'true-client-ip'`, `'x-forwarded-for'`).
- `xffDepth` — number of trusted proxies in front of the server when `addressHeader` is `'x-forwarded-for'`. Default: `1`.
- `requestIdHeader` — forwarded correlation-id header (`'x-request-id'`). Seeds `getRequestContext().requestId`.

```ts
await Mochi.serve({
  proxy: {
    origin: 'https://my.site',
    addressHeader: 'x-forwarded-for',
    xffDepth: 3,
  },
  routes,
});
```

<Callout type="danger">

**Only trust forwarded headers behind a trusted proxy.** Leave the header options unset unless a proxy you control overwrites them. When the app is reachable directly, clients can spoof these headers.

</Callout>

#### `xffDepth` and spoofing

`X-Forwarded-For` is comma-separated. Each proxy appends the address it saw. The framework reads from the **right**, skipping `xffDepth - 1` trusted proxies, so `xffDepth: 3` returns the real client:

```
spoofed, client, proxy1, proxy2   # xffDepth: 3 → "client" (spoofed entry ignored)
```

Set `xffDepth` to the number of proxies that append to the header, never higher. With one proxy and `xffDepth: 2`, a client can send its own `X-Forwarded-For`, and the entry the framework reads is the one the client wrote:

```
client            # no header sent → "client" (too short: falls back to the rightmost entry and warns)
1.2.3.4, client   # client sent "1.2.3.4" → "1.2.3.4" (the client chose its own address)
```

<Callout type="warning">

**Use `getClientAddress()` for a trusted client IP.** Reading `x-forwarded-for` directly could return a spoofable address. Pass the right `xffDepth`: a value larger than the number of proxies that append lets a client choose its own address. Mochi warns once when a request has fewer entries than `xffDepth`.

</Callout>

#### `getClientAddress()`

```ts
import { getRequestContext, Mochi } from 'mochi-framework';

export const handler = Mochi.api(() => {
  const ip = getRequestContext().getClientAddress();
  return Response.json({ ip });
});
```

Without `proxy.addressHeader`, this returns Bun's connecting `remoteAddress` (or `null` if unavailable).

### Content-Security-Policy nonce

<VersionNote since="0.10.0" message="The csp option ships in the next Mochi release (0.10.0)." />

`csp: true` mints a fresh nonce for every request and stamps it on each `<script>` Mochi emits: the island bootstrap, the server-island loader, the shell's inline config, speculation rules, Svelte's `hydratable()` payload, and the dev-only live reload and debug bar. Mochi sets no header itself. Read the nonce with [`getCspNonce()`](/docs/request-context/#getcspnonce) and send the policy from middleware:

```ts
// file: src/index.ts
import { Mochi, getCspNonce, type Handle } from 'mochi-framework';

const csp: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  const nonce = getCspNonce();
  if (nonce) {
    response.headers.set('Content-Security-Policy', `script-src 'nonce-${nonce}'; object-src 'none'; base-uri 'self'`);
  }
  return response;
};

await Mochi.serve({ csp: true, handle: csp, routes });
```

Islands and deferred server islands load through the nonced scripts, so a plain `'nonce-…'` source is enough. The fall-through 404 and the error page carry the nonce too. Island props travel in `<script type="application/json">` blocks, which CSP does not gate, so they get none.

Scripts your own markup emits are not stamped: pass `getCspNonce()` to them yourself. With `csp` off the HTML is unchanged.

<Callout type="warning">

The nonce changes on every response, so do not cache rendered HTML with `csp` on. A page replayed from a `MochiCache` carries an old nonce that no longer matches the header, and a CDN that caches the header too serves every visitor the same nonce, which an injected script can then reuse.

</Callout>

Responses sent before middleware runs, such as the [protection](/docs/protection/) interstitial for a page route and the CSRF `403`, never reach the handle above and go out without a policy.
