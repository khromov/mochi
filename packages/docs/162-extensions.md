---
title: 'Extensions (hooks & filters)'
slug: extensions
description: 'Observe or transform framework behavior at lifecycle moments using hooks and filters.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

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

### Hooks

#### `mochi:init`

Fires as the very first thing inside `Mochi.serve()`, before any framework state is set up. Async.

Nothing the framework mounts exists yet — in particular [queues](/docs/queues/) are created after the server binds, so `Mochi.getQueue()` throws here. Add jobs from `mochi:ready` or from a queue's `recover` callback instead.

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

#### `mochi:listening`

Fires immediately after `Bun.serve()` returns the bound server, before queues are mounted and before warmup runs. Use it when you need the port as early as possible — announcing the address, opening a tunnel, signalling a supervisor. Async.

```ts
await Mochi.serve({
  eventHooks: {
    'mochi:listening': async ({ server }) => {
      await notifySupervisor({ port: server.port });
    },
  },
  routes,
});
```

#### `mochi:queuesMounted`

Fires once every queue in `Mochi.serve({ queues })` is live, before each queue's `recover` callback runs. `ctx.queues` lists the mounted names. This is the earliest point at which [`Mochi.getQueue()`](/docs/queues/#mochigetqueue) resolves. Async.

```ts
await Mochi.serve({
  eventHooks: {
    'mochi:queuesMounted': async ({ queues }) => {
      log.info(`queues live: ${queues.join(', ')}`);
    },
  },
  queues,
  routes,
});
```

<Callout type="info">

For re-enqueuing a single queue's unfinished work, prefer that queue's own [`recover`](/docs/queues/#recovery-on-start) callback — it receives the handle directly and keeps the logic next to the queue it belongs to. Reach for `mochi:queuesMounted` when the work spans queues or isn't queue-specific.

</Callout>

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

The hook does not fire when the framework rejects the request before route handling (e.g. CSRF block). `getRequestContext()` is available inside the hook for all four kinds and exposes the matched `requestId`, `url`, and `params`.

#### `image:localAssetEmitted`

Fires at **build time**, right after a locally-imported image (`import hero from './hero.png'`) has been content-hashed and written to `<outDir>/assets/`. The context carries the `sourcePath`, the on-disk `diskPath`, the served `url` (post-`image:localAssetUrl`), intrinsic `width`/`height`, decoded `format`, and `contentType`. Use it to mirror imported assets to a CDN, generate extra derivatives, or record a build manifest. Async.

```ts
await Mochi.serve({
  eventHooks: {
    'image:localAssetEmitted': async ({ diskPath, url }) => {
      await cdn.upload(url, await Bun.file(diskPath).bytes());
    },
  },
  routes,
});
```

Because assets are content-addressed, the hook fires once per unique asset per build (the second build pass hits the existing file and skips both the write and the hook). Treat any upload as idempotent — concurrent passes could fire it more than once for the same bytes.

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

#### `trailingSlash:redirect`

Override the `trailingSlash` policy for the current request. The filter receives the redirect the framework computed — a `Response` (301/308) when the path isn't canonical, or `null` when no redirect applies. Return the input unchanged to delegate, or `null` to skip the redirect and let the request reach its handler as-is. Sync. Useful for endpoints that must answer at an exact path regardless of the site-wide policy — e.g. an MCP endpoint at `/mcp` under `trailingSlash: 'always'`.

```ts
await Mochi.serve({
  trailingSlash: 'always',
  filters: {
    'trailingSlash:redirect': (redirect, { url }) => (url.pathname === '/mcp' ? null : redirect),
  },
  routes,
});
```

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

<Callout type="warning">

**Use `htmlShell` on `serve()` for full template control.** The `html:shell` filter is for snippet injection only; using it to replace the entire template will bypass placeholder processing and break your layout.

</Callout>

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

#### `payload:compressMinBytes`

The minimum size (bytes) a server-island-prop or image payload must reach before the framework attempts to deflate it ahead of encryption. Below the threshold, zlib framing outweighs any saving, so the deflate call is skipped. Evaluated per payload — the filter receives the (pre-encryption) `payload` bytes in its context, so the threshold can be decided per payload. Sync.

```ts
import { DEFAULT_COMPRESS_MIN_BYTES } from 'mochi-framework';

await Mochi.serve({
  filters: {
    // Raise the bar to 128 B, but never bother deflating payloads that already look binary.
    'payload:compressMinBytes': (def, { payload }) => (payload[0] === 0x89 ? Infinity : 128),
  },
  routes,
});
```

Default is `DEFAULT_COMPRESS_MIN_BYTES` (80), derived empirically — re-run `bun packages/mochi/scripts/compression-threshold.ts` to reproduce. The `payload` is read-only context (mutating it corrupts the ciphertext). The inner "use only if smaller" check still discards any payload that fails to shrink, so raising the threshold only trades a bit of CPU against missed wins; returning `Infinity` disables compression for that payload entirely.

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

#### `consoleLogger:level`

Change the severity a line is written at. Every `consoleLogger()` line ships with a framework-chosen level — request lines are `info`, asset and image lines are `debug`, degradations are `warn` — and this filter overrides that per app. Return one of `'info' | 'warn' | 'log' | 'debug'`; there is no `null`, dropping a line is `consoleLogger:line`'s job. Sync.

It runs **after** the automatic escalation (5xx responses and slow requests are already `'warn'` by the time you see them, so you can de-escalate them too) and **before** `consoleLogger:line`, whose `ctx.level` reports the remapped value. The level still gates against the active [log level](/docs/logging/) — demoting a line to `'debug'` hides it unless you're running at `level: 'debug'`.

```ts
await Mochi.serve({
  filters: {
    // Job enqueues are noise in this app; health checks matter more than usual.
    'consoleLogger:level': (level, { path, source }) => {
      if (source.name === 'queue:added') {
        return 'debug';
      }
      return path.startsWith('/health') ? 'warn' : level;
    },
  },
  routes,
});
```

Context fields are the same as `consoleLogger:line` below, minus `level` (that's the filtered value): `label`, `path`, `status`, `kind`, `source`.

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

- `level` — resolved log level (`'warn'` for 5xx / slow requests, otherwise the per-event default, after any `consoleLogger:level` remap).
- `label` — event tag (`'GET '`, `'WS  '`, `'BUILD'`, `'CACHE'`, …).
- `path` — URL path for requests; cache key for `CACHE`/`PAGECACHE`; source file for `BUILD`/`HMR`; `localhost:port` for `BOOT`.
- `status` — HTTP status (request lines only).
- `kind` — `'page' | 'api' | 'file' | 'asset' | 'image' | 'fallback' | 'error'` (request lines only).
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

Rewrite the encrypted URL returned by `getImageUrl()` (and the `<Image>` component) before it reaches your markup — typically to prepend a CDN origin in front of the relative `/_mochi/image/…?p=<token>` path. The context carries the source `src`, the cosmetic `filename`, and `original` (`true` for a full-size original, `false` for a size variant), so you can route originals and variants differently. Return the URL unchanged to opt out per call. Sync.

```ts
await Mochi.serve({
  filters: {
    'image:url': (url, { original }) => `https://cdn.example.com${url}`,
  },
  routes,
});
```

<Callout type="danger">
Only rewrite the **origin/prefix** — never the last path segment (the `filename`). That segment is authenticated (bound as AAD to the encrypted token), so the image endpoint re-derives it from the served path and rejects (403) any request whose filename was changed. Rewriting the host/prefix is safe; renaming `photo-500x500.webp` is not. Mochi logs a warning if a filter changes the filename.
</Callout>

#### `image:fileFilter`

Controls which local imports are intercepted and turned into `ImportedImage` objects. The default (`IMAGE_FILE_FILTER`, exported from `mochi-framework`) matches `png`, `jpg`/`jpeg`, `webp`, `avif`, and `gif`. Return a narrower regex to opt some files out (they fall through to Bun's default loader), or a wider one to intercept more. Resolved once per build pass — the `target` (`'server' | 'client'`) is in context. Sync.

```ts
import { IMAGE_FILE_FILTER } from 'mochi-framework';

await Mochi.serve({
  filters: {
    // Also treat .bmp imports as images.
    'image:fileFilter': (re) => new RegExp(re.source + '|\\.bmp$', 'i'),
  },
  routes,
});
```

<Callout type="warning">

Widening the regex only decides which files reach the loader — each is still decoded by `Bun.Image` and validated against the accepted raster formats (png/jpeg/webp/avif/gif). A file whose format Mochi can't decode still throws a build error, so extending to a genuinely new format needs `Bun.Image` decode support, not just a matching extension.

</Callout>

#### `image:localAssetFilename`

Rename the content-hashed file a local image import emits under `<outDir>/assets/`. The default is `<slug>-<hash>.<ext>`; the context carries the `sourcePath`, `hash`, `ext`, `format`, and intrinsic `width`/`height`. The filter runs in **both** build passes, so it must be deterministic — a non-deterministic name would make the SSR and client bundles disagree on the URL. Keep the result a single path segment (the built-in `/asset/:filename` route serves one segment). Sync.

```ts
await Mochi.serve({
  filters: {
    'image:localAssetFilename': (name, { hash, ext }) => `img.${hash}.${ext}`,
  },
  routes,
});
```

#### `image:localAssetUrl`

Rewrite the `src` URL a local image import resolves to. The default is `${assetPrefix}/asset/<filename>` (served from disk by the built-in route); the context carries the `sourcePath`, `filename`, `assetPrefix`, and `format`. Like `image:localAssetFilename`, it runs in both passes and must be deterministic. Sync.

```ts
await Mochi.serve({
  filters: {
    'image:localAssetUrl': (_url, { filename }) => `https://cdn.example.com/${filename}`,
  },
  routes,
});
```

<Callout type="warning">

Returning an absolute (CDN) URL intentionally bypasses the built-in `/asset/` route and the local-disk shortcut used when `<Image>` transforms an import — the browser and the image transformer will fetch from that URL instead, so pair it with `image:localAssetEmitted` to upload the bytes there. A same-origin override must stay under `${assetPrefix}/asset/` as a single segment, or the built-in route won't serve it.

</Callout>

#### `email:message`

Intercept every message sent through `Mochi.email()` right before it reaches the transport. The filter receives the fully-resolved message (`from` filled, addresses arrayified, body rendered) and returns a modified message, or `null` to **suppress** the send entirely. The context carries the configured `transport` type (`'log' | 'dev' | 'smtp' | 'custom'`) so you can branch on where the message is headed. Async.

This is the interceptor seam for transactional mail — add an audit BCC, inject compliance headers, or reroute recipients in staging — without replacing the whole transport.

```ts
await Mochi.serve({
  email: { from: 'noreply@app.dev', transport: { type: 'smtp', host: 'smtp.example.com' } },
  filters: {
    'email:message': (message, { transport }) => {
      // In non-production, redirect all real mail to a catch-all inbox.
      if (transport === 'smtp' && process.env.STAGING) {
        return { ...message, to: ['qa@app.dev'], cc: undefined, bcc: undefined };
      }
      return { ...message, headers: { ...message.headers, 'List-Unsubscribe': '<mailto:unsub@app.dev>' } };
    },
  },
  routes,
});
```

Return `null` to veto — the message never reaches a transport (nothing is delivered, nothing is captured into the dev outbox):

```ts
'email:message': async (message) => ((await suppressionList.has(message.to)) ? null : message),
```

A suppressed send still emits an `email:sent` event with `transport: 'suppressed'` (and `consoleLogger()` prints it as a `MAIL … suppressed (filtered)` line), so blocked mail stays observable. `Mochi.email()` resolves to `{ transport: 'suppressed' }` in that case.

#### `captcha:minAgeMs`

The captcha timing floor — a token younger than this is refused. Applied per token, so the floor can vary by form. The context carries the `bits` sealed into the token, its measured `ageMs`, and `limitMs` (the expiry bound the returned floor must stay under). Returning a value at or above `limitMs`, or a negative one, throws — it would reject every token. Sync.

This is the only check enforcing that a submission took human time. The proof-of-work bounds an attacker's **cost** (~2^`bits` hashes per token), not any single solver's latency — solve time is geometrically distributed with no lower bound, so a lucky visitor clears it in milliseconds. A form with fields to type into runs well past the 2s default; a form with nothing to fill in may not.

```ts
import { getRequestContext } from 'mochi-framework';

await Mochi.serve({
  filters: {
    // A one-click confirm has nothing to type, so the default floor would reject real visitors.
    'captcha:minAgeMs': (def) => (getRequestContext().url.pathname === '/confirm/' ? 250 : def),
  },
  routes,
});
```

#### `captcha:driftAllowanceMs`

Slack added to `maxAgeMs` before a token is refused as expired. A token's age is `Date.now()` at verify minus the `iat` sealed at mint — in a multi-instance deploy those two reads come off different machines, so the difference carries that pair's clock skew. The allowance absorbs it. Resolved once alongside the rest of the captcha options, since skew is a property of the fleet rather than of a request. Sync.

```ts
await Mochi.serve({
  filters: {
    // Single instance — mint and verify share one clock, so no slack is needed.
    'captcha:driftAllowanceMs': () => 0,
  },
  routes,
});
```

The allowance only ever widens the **expiry** side, and is deliberately not applied to `minAgeMs`. Padding a floor means subtracting from it, so an allowance wider than the floor would silently delete the too-fast check rather than soften it — leaving a config that still reads like it enforces a 2s floor while accepting instant submissions. Use `captcha:minAgeMs` to move the floor, so the change is explicit.

#### `queue:recoveryStallWarningMs`

How long a queue's [`recover`](/docs/queues/#recovery-on-start) callback may run before Mochi logs a warning naming it. Resolved once per queue that declares one, as its recovery starts, so a queue reading a slow store can be given more room than its siblings. Sync.

Recovery is never cut short — abandoning it would drop the jobs it was about to add. The warning exists because everything downstream (warmup, `mochi:ready`, `Mochi.serve()` resolving) waits behind it, so a stuck callback would otherwise hang silently. Defaults to `30_000`.

```ts
await Mochi.serve({
  filters: {
    // This one rebuilds its backlog from a cold object store; 30s is normal for it.
    'queue:recoveryStallWarningMs': (def, { queue }) => (queue === 'thumbnails' ? 120_000 : def),
  },
  queues,
  routes,
});
```

Return `0` to silence the warning for a queue entirely — no timer is scheduled at all.
