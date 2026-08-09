---
title: 'Serve options'
slug: serve-options
description: 'Reference for every configuration option on Mochi.serve().'
---

<script>
  import Callout from './_components/Callout.svelte';
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

**Shutdown signals.** `Mochi.serve()` installs `SIGTERM` and `SIGINT` listeners that fire the [`mochi:shutdown`](/docs/extensions/#mochishutdown) hook, drain queues, then stop the server and exit with code 0. In-flight requests get `shutdownTimeout` ms to finish. Anything still connected is force-closed. A second signal exits immediately with code 1. An open WebSocket never drains, so shutdown waits the full `shutdownTimeout` before force-closing. Keep the timeout tight enough for your orchestrator's grace period.

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
- `optionsStorage` — persistent backend for the [`MochiOptions`](/docs/options/) key/value store: `{ sqlite: path }`, `{ postgres: url }`, or `{ pglite: instance }`. There is no memory backend; without it every `MochiOptions` call throws. See [Options](/docs/options/).
- `publicDir` — directory served as static assets. Default: `./public`. Scanned from disk at startup in every mode, so it must ship with a production deploy.
- `outDir` — base directory for build artifacts and dev cache. Default: `./.mochi`.
- `assetPrefix` — URL prefix for framework client assets and the server-island endpoint. Must start with `/`, must not be `/` or end with `/`. Default: `/_mochi`.
- `additionalWatchPaths` — extra dev-mode watcher paths added to `src` and `public`. Default: `[]`.
- `barrelWarnings` — warn when a dependency drags a large, tree-shaken module into the build graph. Default: enabled. See [Development mode](/docs/development-mode/).
- `build` — output controls for `mochi-framework build`. The runtime ignores it. See [CLI](/docs/cli/).
- `svelteConfigPath` — path to a Svelte config file. Default: `./svelte.config.js`. See [Svelte config](/docs/svelte-config/).
- `svelteCompiler` — which compiler emits component JS. Default: `'svelte'`. `'rsvelte'` needs `@mochi-framework/rsvelte`. See [rsvelte](/docs/rsvelte/).
- `optimize` — run the whole-program svelte-shaker pass over `.svelte` source before compiling, so the compiler emits less code. **Production only**, and needs `@mochi-framework/svelte-shaker`. `true` shakes everything; `{ enabled, exclude }` gives finer control. Default: `false`. See [Svelte Shaker](/docs/svelte-shaker/).
- `csrf` — `MochiCsrfOptions` for the origin-header check. See below.
- `proxy` — `MochiProxyOptions` for trusted reverse-proxy headers. See below.
- `hooks` / `filters` — named lifecycle hooks and value filters. See [Extensions](/docs/extensions/).
- `warmup` — warm the SSR pipeline at startup by invoking every static page route once. `boolean | { enabledInProd, enabledInDev }`. Default: `false`. See below.
- `bun` — escape hatch for raw `Bun.serve()` options Mochi does not surface — `idleTimeout`, `maxRequestBodySize`, `reusePort`, `tls`. `fetch` / `websocket` / `routes` / `error` are framework-owned and throw if set. See below.

<Callout type="info">

**Sync `assetPrefix` between build and runtime.** When using a prebuilt manifest, pass `assetPrefix` to the `build()` call (or `--asset-prefix`) so the baked-in URLs match. The manifest's URLs take precedence at runtime if the two disagree.

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

In production, the check refuses every form mutation until `proxy.origin` (or `proxy.hostHeader`) is set, so the deployment break is loud. In development the request is allowed through with a `[mochi]` warning.

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

<Callout type="warning">

**Use `getClientAddress()` for a trusted client IP.** Reading `x-forwarded-for` directly could return a spoofable address. Pass the right `xffDepth`.

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
