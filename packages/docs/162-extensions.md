---
title: 'Extensions (hooks & filters)'
slug: extensions
description: 'Observe or transform framework behavior at lifecycle moments using hooks and filters.'
---

## Extensions (hooks & filters)

Extension points for `Mochi.serve()`. Pass `eventHooks` and `filters` as top-level options; each registry holds at most one entry per name.

```ts
// file: src/index.ts
await Mochi.serve({
  eventHooks: {
    'mochi:ready': async ({ server }) => log.info(`up on ${server.url}`),
  },
  filters: {
    'cookie:defaults': () => ({ secure: true, httpOnly: true, sameSite: 'Lax', path: '/' }),
  },
  routes,
});
```

Names use a `namespace:camelCase` convention. Each name is registered in a typed kind-map; whether the user callback is sync or async is declared per name and enforced by TypeScript.

### Hooks vs filters

- **Hooks** run a user function at a specific framework moment. No return value — observation or side effects only.
- **Filters** replace a framework default value. The callback receives the existing value and returns the new one.

Do **NOT** mutate framework state from a filter or return a value from a hook; instead, pick the surface that matches the intent — observation goes in a hook, value substitution goes in a filter.

### Hooks

#### `mochi:init`

Fires as the very first thing inside `Mochi.serve()`, before any framework state is set up. Async.

```ts
await Mochi.serve({
  eventHooks: {
    'mochi:init': async ({ options }) => {
      await warmCache(options);
    },
  },
  routes,
});
```

#### `mochi:ready`

Fires after `Bun.serve()` returns the bound server, just before `Mochi.serve()` resolves. Use it for post-bind setup that needs the live `Server` instance — warm caches, register with service discovery, kick off background workers. Async.

```ts
await Mochi.serve({
  eventHooks: {
    'mochi:ready': async ({ server }) => {
      await registerWithServiceDiscovery(server.url);
    },
  },
  routes,
});
```

#### `mochi:shutdown`

Fires when the framework receives `SIGTERM` or `SIGINT`. The framework awaits the hook, then calls `server.stop()`. A second signal force-exits with code 1. Async.

```ts
await Mochi.serve({
  eventHooks: {
    'mochi:shutdown': async ({ signal }) => {
      logger.info(`Got ${signal}, draining…`);
      await db.close();
    },
  },
  routes,
});
```

The framework installs the signal listeners as part of `serve()`. Pre-existing user listeners on those signals are not displaced — Node.js dispatches signals to every registered listener.

#### `route:matched`

Fires when a `Mochi.page` / `Mochi.api` / `Mochi.ws` / `Mochi.sse` route matches an incoming request, after the CSRF check passes (for page/api) and before middleware/handler runs. The `kind` field tells you which route type matched. Sync.

```ts
await Mochi.serve({
  eventHooks: {
    'route:matched': ({ pattern, kind, request }) => {
      tracer.startSpan(`${kind}:${pattern}`, { method: request.method });
    },
  },
  routes,
});
```

Do **NOT** do heavy work in `route:matched`; instead, use a `handle` middleware — this hook is observation only and runs on every matching request.

The hook does not fire when the framework rejects the request before route handling (e.g. CSRF block). `getRequestContext()` is available inside the hook for all four kinds and exposes the matched `requestId`, `url`, and `params`.

### Filters

#### `csrf:formContentTypes`

Override the `Set<string>` of content types that gate the built-in CSRF check. Resolved once at startup. Sync.

```ts
await Mochi.serve({
  filters: {
    'csrf:formContentTypes': (types) => new Set([...types, 'application/csp-report']),
  },
  routes,
});
```

Default exported as `DEFAULT_FORM_CONTENT_TYPES` from `mochi-framework`.

#### `csrf:protectedMethods`

Override the `Set<string>` of HTTP methods the CSRF check applies to. Resolved once at startup. Sync.

```ts
await Mochi.serve({
  filters: {
    'csrf:protectedMethods': (methods) => {
      methods.delete('DELETE');
      return methods;
    },
  },
  routes,
});
```

Default exported as `DEFAULT_PROTECTED_METHODS` from `mochi-framework`.

#### `csrf:trustedOrigins`

Override the `Set<string>` of cross-origin sources allowed past the CSRF check. Seeded from `csrf.trustedOrigins` (an array on `Mochi.serve()`). Resolved once at startup. Sync.

```ts
await Mochi.serve({
  filters: {
    'csrf:trustedOrigins': (origins) => {
      origins.add('https://embed.example');
      return origins;
    },
  },
  routes,
});
```

#### `csrf:check`

Override the framework's CSRF decision for the current request. The filter receives the framework's default decision — `null` if the request would pass, a `Response` (typically 403) if it would be blocked. Return the input unchanged to delegate, `null` to bypass, or a fresh `Response` to substitute a custom block. Sync.

```ts
await Mochi.serve({
  filters: {
    'csrf:check': (decision, { request, url }) => {
      // Webhook endpoint with its own auth — bypass CSRF entirely.
      if (url.pathname.startsWith('/webhooks/')) {
        return null;
      }
      return decision;
    },
  },
  routes,
});
```

Do **NOT** bypass CSRF on a state-mutating endpoint; instead, prefer the narrower `csrf:trustedOrigins` filter or `csrf.checkOrigin: false` on `Mochi.serve()`.

#### `cookie:defaults`

Default `CookieSerializeOptions` merged into every `cookies.set()` call. Per-call options win on a per-field basis. `path` and `domain` from defaults also apply to `cookies.delete()` so the browser still matches the original `Set-Cookie`. Resolved once at startup. Sync.

```ts
await Mochi.serve({
  filters: {
    'cookie:defaults': () => ({ secure: true, httpOnly: true, sameSite: 'Lax', path: '/' }),
  },
  routes,
});
```

#### `html:shell`

Modify the HTML shell template once at startup. The value is the resolved template string with `{{mochi.head}}`, `{{mochi.css}}`, `{{mochi.body}}`, `{{mochi.script}}` placeholders intact. Sync.

```ts
await Mochi.serve({
  filters: {
    'html:shell': (tpl) => tpl.replace('{{mochi.head}}', '<meta name="csp-nonce" content="abc123">{{mochi.head}}'),
  },
  routes,
});
```

Do **NOT** use `html:shell` for full template ownership; instead, set `htmlShell` directly on `Mochi.serve()` — this filter is for snippet injection.

#### `serverIsland:secretKey`

Override the secret key used to encrypt server-island props and image payloads. The default value is the `MOCHI_KEY` env var (or a fresh random key if unset). Use this to source the key from KMS / Vault / a secret manager. Async.

```ts
await Mochi.serve({
  filters: {
    'serverIsland:secretKey': async () => {
      const raw = await kms.getSecret('mochi-island-key');
      return Buffer.from(raw, 'base64url');
    },
  },
  routes,
});
```

The `envKeyPresent` field on the filter context tells you whether `MOCHI_KEY` was set, in case you want to fall back to the env-derived default.

#### `compile:preprocessors`

A list of Svelte `PreprocessorGroup` to run on every `.svelte` source file before compilation. Applies to both server and client targets — branch on `target` in the filter context if you only want one. Sync.

```ts
import autoprefixer from 'autoprefixer';
import postcss from 'svelte-preprocess';

await Mochi.serve({
  filters: {
    'compile:preprocessors': () => [postcss({ postcss: { plugins: [autoprefixer] } })],
  },
  routes,
});
```

Default is `[]`. Preprocessors do not currently apply to `.md` / `.svx` files (mdsvex handles those itself).

#### `publicDir:scan`

Modify the `Map<urlPath, diskPath>` of files served from the public directory. The filter receives a fresh copy after each scan (initial startup + every dev-mode `public/` change), so in-place mutation is safe. Use it to add virtual files, shadow built-in routes, or rename URLs. Async.

```ts
await Mochi.serve({
  filters: {
    'publicDir:scan': async (files) => {
      files.set('/robots.txt', '/etc/mochi/robots.generated.txt');
      return files;
    },
  },
  routes,
});
```

A `Mochi.page` / `Mochi.api` route on the same URL still wins — the filter only adds entries; the wiring step skips entries whose URL is already a user route, with a `[mochi]` warning.

#### `consoleLogger:line`

Mutate or drop a formatted line right before `consoleLogger()` writes it. The first argument is the fully-rendered string (timestamp, label, kind, path, status, duration — with ANSI colour codes already applied). The second is a structured context with the underlying values, so you can filter without grepping ANSI-coloured strings. Return the string to log it, a rewritten string to substitute, or `null` to drop the line entirely. Sync.

Mochi ships `silenceInternalRoutes`, a built-in filter that drops two routinely-noisy paths from the console: Chrome's `/.well-known/appspecific/com.chrome.devtools.json` probe and the framework admin routes under `/__mochi/admin/*`.

```ts
import { Mochi, silenceInternalRoutes } from 'mochi-framework';

await Mochi.serve({
  filters: {
    'consoleLogger:line': silenceInternalRoutes,
  },
  routes,
});
```

Context fields:

- `level` — resolved log level (`'warn'` for 5xx / slow requests, otherwise the per-event default).
- `label` — event tag (`'GET '`, `'WS  '`, `'BUILD'`, `'CACHE'`, …).
- `path` — URL path for requests; cache key for `CACHE`/`PAGECACHE`; source file for `BUILD`/`HMR`; `localhost:port` for `BOOT`.
- `status` — HTTP status (request lines only).
- `kind` — `'page' | 'api' | 'asset' | 'fallback' | 'error'` (request lines only).
- `source` — `{ name, payload }` for the originating `mochiEvents` event. Narrow on `source.name` to access typed per-event fields (e.g. `requestId` on `'request'`, `size` on `'ws:message'`, `hydratableCount` on `'compile:complete'`).

```ts
'consoleLogger:line': (line, { source }) => {
  if (source.name === 'request' && source.payload.duration > 1000) {
    return `[SLOW] ${line}`;
  }
  return line;
}
```

#### `image:maxRedirects`

Override how many upstream redirects the image fetcher will follow when resolving a source. Each hop is re-validated against `allowedHosts` / `blockPrivateNetworks` (an allowed host can't redirect into a private network), so this caps how long that chain may be. The default is `5`; return a smaller number to tighten it, `0` to reject any redirect, or a larger number for sources behind several hops. The `src` being fetched is in the context, so you can decide per-host. Sync.

```ts
await Mochi.serve({
  filters: {
    'image:maxRedirects': (max, { src }) => (new URL(src).hostname === 'cdn.example.com' ? 10 : max),
  },
  routes,
});
```

#### `image:url`

Rewrite the signed URL returned by `getResizedImage()` / `getImage()` (and the `<Image>` component) before it reaches your markup — typically to prepend a CDN origin in front of the relative `/_mochi/image/…?p=<token>` path. The context carries the source `src`, the cosmetic `filename`, and `original` (`true` for `getImage`, `false` for resized variants), so you can route originals and variants differently. Return the URL unchanged to opt out per call. Sync.

```ts
await Mochi.serve({
  filters: {
    'image:url': (url, { original }) => `https://cdn.example.com${url}`,
  },
  routes,
});
```
