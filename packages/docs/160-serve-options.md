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

In production (`development: false`), prebuilt JS/CSS bundles served from `assetPrefix` (default `/_mochi`) get `Cache-Control: public, max-age=31536000, immutable` automatically. Filenames are content-hashed, so any change yields a new URL — there's nothing to invalidate. In development the header is omitted so live-reload edits aren't pinned in the browser cache. Public-dir files (`./public/...`) are read from `publicDir` on disk in both modes — scanned once at startup, and re-scanned live in development. They keep Bun's default static-route headers; their URLs are stable, so don't mark them immutable. To override, mutate `response.headers` in a `handle` middleware.

<Callout type="warning">

**One serve() call per process.** To run multiple sites, spawn separate processes on different ports. A second call within the same process throws `Mochi.serve() has already been called. Only one instance is allowed.`

</Callout>

<Callout type="info">

**Shutdown signals.** `Mochi.serve()` installs `SIGTERM` and `SIGINT` listeners that fire the [`mochi:shutdown`](/docs/extensions/#mochishutdown) hook, drain queues, then stop the server and exit with code 0. In-flight requests get `shutdownTimeout` ms to finish; anything still connected after that is force-closed. A second signal exits immediately with code 1. Existing user listeners on those signals are not displaced — Node.js dispatches signals to every registered listener.

The forced fallback is not optional: a plain `server.stop()` never resolves while a WebSocket is open, so in development a single browser tab holding the live-reload socket would otherwise wedge the process until it is `SIGKILL`ed. The same applies in production to any live `Mochi.ws` connection — while one is open the graceful drain never completes, so shutdown always waits the full `shutdownTimeout` before force-closing. Keep the timeout tight enough for your orchestrator's grace period.

</Callout>

### Options reference

- `port`: TCP port to listen on. No default — set it explicitly.
- `hostname`: Interface to bind. Defaults to Bun's default (`0.0.0.0`).
- `development`: Enables live reload, debug bar, and the dev error overlay. Default: `true`.
- `liveReload`: Enable the dev-mode live-reload WebSocket (`/__mochi_live_reload` + the `mochi-live-reload` web component). Default: matches `development`. Set to `false` to keep the debug bar but skip the WS — useful behind a proxy where the socket is flaky.
- `shutdownTimeout`: Grace period in ms for in-flight requests to finish on `SIGTERM`/`SIGINT` before connections are force-closed and the process exits. Default: `5000` in production, `0` in development. `0` force-closes immediately. Note that an open WebSocket never drains, so shutdown pins to this full value whenever one is connected — set it no larger than your orchestrator's kill grace period.
- `routes`: `Record<string, MochiRouteValue>` of route paths to `Mochi.page` / `Mochi.api` / `Mochi.ws` / `Mochi.sse` registrations.
- `fetch`: `(req, server) => Response` fallback handler invoked when no route matches. Default: built-in 404.
- `manifest`: Path to a prebuilt manifest JSON. Default: `<outDir>/manifest.json`.
- `htmlShell`: Path to an `.html` template or an inline template string. Default: built-in shell. See `Custom HTML shell`.
- `handle`: A `Handle` (or `sequence(...)` of them) that wraps every request. See `Middleware (hooks)`.
- `errorPage`: Path to a Svelte component rendered for uncaught page errors and unmatched routes. Default: built-in minimal error page. See `Error handling`.
- `handleError`: `HandleError` hook invoked before the error page renders; may override status/message or return a `Response`. See `Error handling`.
- `compressServerIslandProps`: Deflate-compress server-island props when it reduces size. Default: `true`.
- `inlineNestedIslands`: Render nested `mochi:defer` islands in-process during an island fetch instead of emitting further client fetches; `mochi:defer:visible` children always keep their own fetch, and a single call site opts out with `mochi:defer={{ inline: false }}`. Default: `true`. See `Server islands`.
- `logger`: Built-in request logger. Default: `{ enabled: true }`. Pass `{ enabled: false }` to disable, or override `slowThreshold` / `verySlowThreshold`.
- `publicDir`: Directory served as static assets (cwd-relative). Default: `./public`. Scanned from disk at startup in every mode, so it must ship with a production deploy — the build never copies it. `mochi-framework build` picks this value up from your `Mochi.serve()` call unless `--public-dir` overrides it.
- `outDir`: Base directory for build artifacts and dev cache (cwd-relative). Default: `./.mochi`. Production writes here directly; development nests under `<outDir>/dev` so a dev run can't collide with a production build (and is wiped clean on every dev startup).
- `assetPrefix`: URL prefix for framework client assets and the server-island endpoint. Must start with `/`, must not be `/`, must not end with `/`, must not contain whitespace or `..`. Default: `/_mochi`.
- `additionalWatchPaths`: Extra dev-mode watcher paths added to the defaults `src` and `public`. Default: `[]`.
- `barrelWarnings`: Warning when a dependency drags a large, almost-entirely-tree-shaken module into the build graph (a "barrel import" that slows rebuilds). Fires once per package in dev, and as one grouped summary line in a production build. Default: enabled. `false` silences it; `{ ignore: ['pkg'] }` suppresses specific packages; `{ minBytes }` overrides the 50 KB size threshold. See `Development mode`.
- `build`: Output controls for `mochi-framework build`; ignored by the runtime. `{ resources: false }` hides the emitted-resources list (the summary line keeps its asset count). See `CLI`.
- `svelteConfigPath`: Path to a Svelte config file. Default: `./svelte.config.js`. See `Svelte config`.
- `svelteCompiler`: Which compiler emits component JS. Default: `'svelte'`. `'rsvelte'` uses the Rust compiler and needs the optional `@mochi-framework/rsvelte` package; overridable with `MOCHI_SVELTE_COMPILER`. See `rsvelte compiler`.
- `optimize`: Run the whole-program svelte-shaker pass over `.svelte` source before compiling, so the Svelte compiler emits less code. **Production only**, and needs the optional `@mochi-framework/svelte-shaker` package. `true` shakes everything; `{ enabled, exclude }` gives finer control. Default: `false`. See `Svelte Shaker optimization`.
- `csrf`: `MochiCsrfOptions` controlling the origin-header check. See `CSRF` below.
- `proxy`: `MochiProxyOptions` describing trusted reverse-proxy headers. See `Proxy` below.
- `hooks`: `MochiHooks` map of named lifecycle hooks. See `Extensions (hooks & filters)`.
- `filters`: `MochiFilters` map of named value-replacement filters. See `Extensions (hooks & filters)`.
- `warmup`: Warm the SSR pipeline at startup by invoking every static page route once. `boolean | { enabledInProd: boolean; enabledInDev: boolean }`. `true` warms in **production only**; pass the object form for per-mode control. Default: `false`. See `Route warmup` below.
- `bun`: Escape hatch for raw `Bun.serve()` options Mochi doesn't surface — e.g. `idleTimeout`, `maxRequestBodySize`, `reusePort`, `tls`. Spread into `Bun.serve()`; `fetch` / `websocket` / `routes` / `error` are framework-owned and throw if set. See `Raw Bun.serve options` below.

<Callout type="info">

**Sync `assetPrefix` between build time and runtime.** When using a prebuilt manifest, pass `assetPrefix` to the `build()` call (or `--asset-prefix`) so the baked-in URLs match. The manifest's precomputed URLs take precedence at runtime if the two disagree, causing silent breakage.

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

<Callout type="danger">

**Only trust forwarded headers behind a trusted proxy.** Leave the header options unset unless a proxy you control overwrites them. When the app is reachable directly, clients can spoof these headers.

</Callout>

#### `xffDepth` and spoofing

`X-Forwarded-For` is comma-separated — each proxy appends the address it saw. With three trusted proxies and no spoofing:

```
client, proxy1, proxy2
```

The framework reads from the **right**, skipping `xffDepth - 1` trusted proxies, so `xffDepth: 3` returns `client`. Reading from the right blocks spoofing: a client setting its own `X-Forwarded-For` gets pushed leftward by each trusted proxy.

```
spoofed, client, proxy1, proxy2   # xffDepth: 3 → "client" (spoofed entry ignored)
```

<Callout type="warning">

**Use `getClientAddress()` for a trusted client IP.** Reading `x-forwarded-for` directly could return a spoofable address. Pass the right `xffDepth` to `getClientAddress()`; read the raw header only when you want the leftmost address (e.g. geolocation).

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
