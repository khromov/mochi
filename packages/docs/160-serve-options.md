---
title: 'Serve options'
slug: serve-options
description: 'Reference for every configuration option available on Mochi.serve().'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Serve options

`Mochi.serve(options)` boots the Bun server and registers routes. Pass a single `MochiServeOptions` object — every field below is optional except `routes`.

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

Response compression is opt-in via the [`compress()` middleware](/docs/middleware/#compress) — add it to `handle: sequence(...)` to negotiate brotli or gzip per client.

### Asset caching

In production (`development: false`), prebuilt JS/CSS bundles served from `assetPrefix` (default `/_mochi`) get `Cache-Control: public, max-age=31536000, immutable` automatically. Filenames are content-hashed, so any change yields a new URL — there's nothing to invalidate. In development the header is omitted so live-reload edits aren't pinned in the browser cache. Public-dir files (`./public/...`) keep Bun's default static-route headers; their URLs are stable, so don't mark them immutable. To override, mutate `response.headers` in a `handle` middleware.

Do **NOT** call `Mochi.serve()` more than once per process; instead, run a second site as a separate process on a different port. A second call throws `Mochi.serve() has already been called. Only one instance is allowed.`

<Callout type="info">

**Shutdown signals.** `Mochi.serve()` installs `SIGTERM` and `SIGINT` listeners that fire the [`mochi:shutdown`](/docs/extensions/#mochishutdown) hook and call `server.stop()`. A second signal force-exits with code 1. Existing user listeners on those signals are not displaced — Node.js dispatches signals to every registered listener.

</Callout>

### Options reference

- `port`: TCP port to listen on. No default — set it explicitly.
- `hostname`: Interface to bind. Defaults to Bun's default (`0.0.0.0`).
- `development`: Enables live reload, debug bar, and the dev error overlay. Default: `true`.
- `liveReload`: Enable the dev-mode live-reload WebSocket (`/__mochi_live_reload` + the `mochi-live-reload` web component). Default: matches `development`. Set to `false` to keep the debug bar but skip the WS — useful behind a proxy where the socket is flaky.
- `routes`: `Record<string, MochiRouteValue>` of route paths to `Mochi.page` / `Mochi.api` / `Mochi.ws` / `Mochi.sse` registrations.
- `fetch`: `(req, server) => Response` fallback handler invoked when no route matches. Default: built-in 404.
- `manifest`: Path to a prebuilt manifest JSON. Default: `<outDir>/manifest.json`.
- `htmlShell`: Path to an `.html` template or an inline template string. Default: built-in shell. See `Custom HTML shell`.
- `handle`: A `Handle` (or `sequence(...)` of them) that wraps every request. See `Middleware (hooks)`.
- `errorPage`: Path to a Svelte component rendered for uncaught page errors and unmatched routes. Default: built-in minimal error page. See `Error handling`.
- `handleError`: `HandleError` hook invoked before the error page renders; may override status/message or return a `Response`. See `Error handling`.
- `compressServerIslandProps`: Deflate-compress server-island props when it reduces size. Default: `true`.
- `webComponents`: Install minimal server-side shims for custom-element globals (`HTMLElement`, `customElements`, …) so web-component definition modules — local or from npm — can be imported during SSR without crashing. Default: `true`. Set to `false` to skip them (e.g. if an isomorphic dependency misbehaves when `customElements` is defined on the server). See `Web Components`.
- `logger`: Built-in request logger. Default: `{ enabled: true }`. Pass `{ enabled: false }` to disable, or override `slowThreshold` / `verySlowThreshold`.
- `publicDir`: Directory served as static assets (cwd-relative). Default: `./public`.
- `outDir`: Directory for build artifacts and dev cache (cwd-relative). Default: `./.mochi`.
- `assetPrefix`: URL prefix for framework client assets and the server-island endpoint. Must start with `/`, must not be `/`, must not end with `/`, must not contain whitespace or `..`. Default: `/_mochi`.
- `additionalWatchPaths`: Extra dev-mode watcher paths added to the defaults `src` and `public`. Default: `[]`.
- `svelteConfigPath`: Path to a Svelte config file. Default: `./svelte.config.js`. See `Svelte config`.
- `csrf`: `MochiCsrfOptions` controlling the origin-header check. See `CSRF` below.
- `proxy`: `MochiProxyOptions` describing trusted reverse-proxy headers. See `Proxy` below.
- `hooks`: `MochiHooks` map of named lifecycle hooks. See `Extensions (hooks & filters)`.
- `filters`: `MochiFilters` map of named value-replacement filters. See `Extensions (hooks & filters)`.
- `warmup`: Warm the SSR pipeline at startup by invoking every static page route once. `boolean | { enabledInProd: boolean; enabledInDev: boolean }`. `true` warms in **production only**; pass the object form for per-mode control. Default: `false`. See `Route warmup` below.

Do **NOT** set `assetPrefix` only at runtime when running against a prebuilt manifest; instead, also pass it to the `build()` call (or `--asset-prefix`) so the manifest's baked-in URLs match. The manifest value wins at runtime when the two disagree.

### Route warmup

Components are compiled at startup, but the render pipeline — `serverProps`, Svelte SSR, HTML shell assembly — stays cold until a route is first visited, so the first request to each page pays a one-time penalty. Set `warmup: true` to invoke every static page route once, in the background, immediately after the server starts listening:

```ts
await Mochi.serve({
  warmup: true, // warms in production only
  routes,
});
```

`warmup: true` warms in **production only** — dev restarts are frequent, and the extra render burst on every reload isn't worth it. For per-mode control, pass an object:

```ts
await Mochi.serve({
  warmup: { enabledInProd: true, enabledInDev: false },
  routes,
});
```

Warmup is fire-and-forget — the server accepts real traffic immediately, and a [`warmup:complete`](/docs/events/) event fires once the batch finishes. Routes are warmed one at a time so each [`request`](/docs/events/#request) event reports its own render duration rather than a cumulative figure. Warmup requests carry `warmup: true` on their `request` event and log under a `WARM` label instead of `GET`, so they're easy to tell apart from real traffic. Each warmed route runs through its real handler (middleware included) as an anonymous `GET`; a route that throws or returns a `5xx` is counted in `warmup:complete`'s `errorCount`, but the SSR module stays warm regardless.

Routes that aren't fully static — parameter segments (`/docs/:slug`) and `*` catch-alls — are **skipped**, since they have no single canonical URL to warm.

Detect warmup hits from your own code to skip side effects that shouldn't fire for synthetic traffic. Both `event.isWarmup` (in [middleware](/docs/middleware/)) and [`getRequestContext().isWarmup`](/docs/request-context/) (in `serverProps`, components, API handlers) are `true` during warmup:

```ts
const analytics: Handle = async ({ event, resolve }) => {
  if (!event.isWarmup) track(event.url.pathname); // skip warmup hits
  return resolve(event);
};
```

<Callout type="info">

Warmup requests run the full handler, so any side effects in `serverProps` (logging, cache priming, counters) fire once at startup unless you guard them with `getRequestContext().isWarmup`. The request carries no cookies or session, so auth-gated `serverProps` will see an anonymous visitor.

</Callout>

### CSRF

`csrf` gates state-mutating form submissions (`POST` / `PUT` / `PATCH` / `DELETE` with `application/x-www-form-urlencoded`, `multipart/form-data`, or `text/plain`) against an origin-header check; the request's `Origin` must match the expected origin or appear in `csrf.trustedOrigins`. JSON endpoints rely on the browser's CORS preflight and aren't checked.

- `checkOrigin`: Compare `Origin` against the resolved expected origin. Default: `true`.
- `trustedOrigins`: Extra origins to allow even when they don't match. Default: `[]`.

```ts
await Mochi.serve({
  proxy: {
    origin: 'https://app.example.com',
  },
  csrf: {
    trustedOrigins: ['https://embed.partner.com'],
    // checkOrigin: false, // disable the check entirely
  },
  routes,
});
```

In production the check refuses every form mutation until `proxy.origin` (or `proxy.hostHeader`) is set, so the deployment break is loud rather than silent. In development the same request is allowed through with a `[mochi]` warning so local work isn't blocked.

Do **NOT** disable `checkOrigin` to silence a 403 in production; instead, configure `proxy.origin` so the framework knows what origin to trust.

### Proxy

`proxy` tells the framework how to recover the public origin (used by the CSRF check) and the real client IP (returned by `getClientAddress()` on the request context) from forwarded headers. Behind a load balancer, CDN, or tunnel, the connection Bun sees is the proxy, not the client.

- `origin`: Explicit public origin (e.g. `'https://my.site'`). Wins over the header options.
- `protocolHeader`: Forwarded-protocol header (typically `'x-forwarded-proto'`).
- `hostHeader`: Forwarded-host header (typically `'x-forwarded-host'`).
- `portHeader`: Forwarded-port header (typically `'x-forwarded-port'`). Only needed when the public port differs.
- `addressHeader`: Forwarded client-IP header (e.g. `'true-client-ip'`, `'x-forwarded-for'`).
- `xffDepth`: Number of trusted proxies in front of the server when `addressHeader` is `'x-forwarded-for'`. Default: `1`.
- `requestIdHeader`: Forwarded correlation-id header (typically `'x-request-id'`). Seeds `getRequestContext().requestId` when set on the inbound request.

```ts
await Mochi.serve({
  proxy: {
    // Either pin the public origin…
    origin: 'https://my.site',
    // …or derive it from forwarded headers.
    protocolHeader: 'x-forwarded-proto',
    hostHeader: 'x-forwarded-host',
    portHeader: 'x-forwarded-port',

    // Client IP for getClientAddress():
    addressHeader: 'x-forwarded-for',
    xffDepth: 3, // 3 trusted proxies in front of the server
  },
  routes,
});
```

Do **NOT** set the header options when the proxy is not trusted to overwrite them; instead, leave them unset. Clients can spoof these headers when reaching the app directly.

#### `xffDepth` and spoofing

`X-Forwarded-For` is comma-separated — each proxy appends the address it saw. With three trusted proxies and no spoofing:

```
client, proxy1, proxy2
```

The framework reads from the **right**, skipping `xffDepth - 1` trusted proxies, so `xffDepth: 3` returns `client`. Reading from the right blocks spoofing: a client setting its own `X-Forwarded-For` gets pushed leftward by each trusted proxy.

```
spoofed, client, proxy1, proxy2   # xffDepth: 3 → "client" (spoofed entry ignored)
```

Do **NOT** read `request.headers.get('x-forwarded-for')` directly when you want a trusted client IP; instead, use `getClientAddress()` with the right `xffDepth`. Read the raw header only when you want the leftmost address (e.g. geolocation where realness matters more than trust).

#### `getClientAddress()`

```ts
import { getRequestContext, Mochi } from 'mochi-framework';

export const handler = Mochi.api(() => {
  const ip = getRequestContext().getClientAddress();
  return Response.json({ ip });
});
```

Without `proxy.addressHeader`, this returns Bun's connecting `remoteAddress` (or `null` if unavailable).
