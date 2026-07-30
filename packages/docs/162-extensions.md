---
title: 'Extensions (hooks & filters)'
slug: extensions
description: 'Observe or transform framework behavior at lifecycle moments with hooks and filters.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Extensions (hooks & filters)

Extension points for `Mochi.serve()`. Pass `eventHooks` and `filters` as top-level options. Each registry holds at most one entry per name.

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

Names use a `namespace:camelCase` convention. Each name is registered in a typed kind-map. Whether the callback is sync or async is declared per name and enforced by TypeScript.

### Hooks vs filters

- **Hooks** run a user function at a framework moment. No return value — observation or side effects only.
- **Filters** replace a framework default value. The callback receives the existing value and returns the new one.

### Server-only

The registry lives in the server process only. It is never shipped to the browser. Pulling the modules behind the registry into a client bundle fails the build, naming the import. To use a filtered value inside a hydratable island, resolve it during SSR and pass it down as a prop.

### Hooks

#### `mochi:init`

Fires first inside `Mochi.serve()`, before any framework state is set up. Async. Queues do not exist yet, so `Mochi.getQueue()` throws here.

#### `mochi:listening`

Fires right after `Bun.serve()` returns the bound server, before queues mount and before warmup. Use it when you need the port as early as possible. Async.

#### `mochi:queuesMounted`

Fires once every queue is live, before each queue's `recover` callback. `ctx.queues` lists the mounted names. Earliest point at which [`Mochi.getQueue()`](/docs/queues/#mochigetqueue) resolves. Async.

<Callout type="info">

For re-enqueuing one queue's unfinished work, prefer that queue's own [`recover`](/docs/queues/#recovery-on-start) callback. Reach for `mochi:queuesMounted` when the work spans queues.

</Callout>

#### `mochi:ready`

Fires after `Bun.serve()` binds, just before `Mochi.serve()` resolves. Use it for post-bind setup that needs the live `Server`: warm caches, register with service discovery, start background workers. Async.

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

Fires on `SIGTERM` or `SIGINT`. The framework awaits the hook, then calls `server.stop()`. A second signal force-exits with code 1. Async.

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

#### `route:matched`

Fires when a route matches, after the CSRF check passes and before middleware/handler runs. `kind` tells you which route type matched. Sync. `getRequestContext()` is available inside.

#### `image:localAssetEmitted`

Fires at **build time**, right after a locally-imported image is content-hashed and written to `<outDir>/assets/`. The context carries `sourcePath`, `diskPath`, `url`, `width`, `height`, `format`, and `contentType`. Use it to mirror imported assets to a CDN. Async. Treat any upload as idempotent.

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

### Filters

#### `csrf:formContentTypes`

Override the `Set<string>` of content types that gate the CSRF check. Resolved once at startup. Sync. Default exported as `DEFAULT_FORM_CONTENT_TYPES`.

#### `csrf:protectedMethods`

Override the `Set<string>` of HTTP methods the CSRF check applies to. Sync. Default exported as `DEFAULT_PROTECTED_METHODS`.

#### `csrf:trustedOrigins`

Override the `Set<string>` of cross-origin sources allowed past the CSRF check. Seeded from `csrf.trustedOrigins`. Sync.

#### `csrf:check`

Override the CSRF decision for the current request. The filter receives the default decision — `null` to pass, a `Response` (usually 403) to block. Return the input to delegate, `null` to bypass, or a fresh `Response` to substitute. Sync.

```ts
'csrf:check': (decision, { request, url }) => {
  if (url.pathname.startsWith('/webhooks/')) return null; // bypass CSRF
  return decision;
},
```

#### `trailingSlash:redirect`

Override the `trailingSlash` policy for the current request. The filter receives the computed redirect (a 301/308 `Response` or `null`). Return the input to delegate, or `null` to skip the redirect. Sync.

```ts
'trailingSlash:redirect': (redirect, { url }) => (url.pathname === '/mcp' ? null : redirect),
```

#### `cookie:defaults`

Default `CookieSerializeOptions` merged into every `cookies.set()` call. Per-call options win per field. Resolved once at startup. Sync.

```ts
'cookie:defaults': () => ({ secure: true, httpOnly: true, sameSite: 'Lax', path: '/' }),
```

#### `html:shell`

Modify the HTML shell template once at startup. The value is the resolved template with `{{mochi.head}}`, `{{mochi.css}}`, `{{mochi.body}}`, `{{mochi.script}}` placeholders intact. Sync.

<Callout type="warning">

**Use `htmlShell` on `serve()` for full template control.** This filter is for snippet injection. Replacing the whole template bypasses placeholder processing and breaks your layout.

</Callout>

#### `serverIsland:secretKey`

Override the secret key used to encrypt server-island props and image payloads. Default: the `MOCHI_KEY` env var (or a fresh random key if unset). Use it to source the key from KMS / Vault. Async. The `envKeyPresent` field says whether `MOCHI_KEY` was set.

```ts
'serverIsland:secretKey': async () => {
  const raw = await kms.getSecret('mochi-island-key');
  return Buffer.from(raw, 'base64url');
},
```

#### `payload:compressMinBytes`

The minimum size (bytes) a server-island-prop or image payload must reach before Mochi deflates it ahead of encryption. Evaluated per payload; the filter receives the pre-encryption `payload` bytes. Sync. Default `DEFAULT_COMPRESS_MIN_BYTES` (80). Return `Infinity` to disable compression for a payload.

#### `compile:preprocessors`

A list of Svelte `PreprocessorGroup` to run on every `.svelte` source before compilation. Applies to server and client targets; branch on `target` in context. Sync. Default `[]`.

```ts
import postcss from 'svelte-preprocess';

'compile:preprocessors': () => [postcss({ postcss: { plugins: [autoprefixer] } })],
```

Bun transpiles `<script lang="ts">` automatically, so you need no TypeScript preprocessor. Preprocessors do not apply to `.md` / `.svx` (mdsvex handles those).

#### `publicDir:scan`

Modify the `Map<urlPath, diskPath>` of files served from the public directory. The filter receives a fresh copy after each scan. Use it to add virtual files, shadow built-in routes, or rename URLs. Async. A `Mochi.page` / `Mochi.api` route on the same URL still wins.

```ts
'publicDir:scan': async (files) => {
  files.set('/robots.txt', '/etc/mochi/robots.generated.txt');
  return files;
},
```

#### `consoleLogger:level`

Change the severity a log line is written at. Return `'info' | 'warn' | 'log' | 'debug'`. Runs after the automatic 5xx/slow-request escalation and before `consoleLogger:line`. The level still gates against the active [log level](/docs/logging/). Sync.

```ts
'consoleLogger:level': (level, { path, source }) => {
  if (source.name === 'queue:added') return 'debug';
  return path.startsWith('/health') ? 'warn' : level;
},
```

Context fields: `label`, `path`, `status`, `kind`, `source`.

#### `consoleLogger:line`

Mutate or drop a formatted line right before `consoleLogger()` writes it. First argument is the rendered string (ANSI colours applied). Second is a structured context. Return the string to log it, a rewrite to substitute, or `null` to drop it. Sync. Mochi ships `silenceInternalRoutes`, which drops the Chrome devtools probe and the `/__mochi/admin/*` routes.

```ts
import { Mochi, silenceInternalRoutes } from 'mochi-framework';

await Mochi.serve({
  filters: { 'consoleLogger:line': silenceInternalRoutes },
  routes,
});
```

Context fields: `level`, `label`, `path`, `status`, `kind`, `source` (`{ name, payload }` — narrow on `source.name` for typed per-event fields).

#### `barrel:warn`

Mutate or drop a [barrel-import warning](/docs/development-mode) before it is logged. First argument is the rendered string. Second is `{ pkg, file, bytes, usedRatio }`. Return the string, a rewrite, or `null` to suppress. Sync.

```ts
'barrel:warn': (line, { pkg, bytes }) => {
  if (pkg === '@lucide/svelte') return null;
  return `${line} (${Math.round(bytes / 1024)} KB parsed)`;
},
```

#### `image:maxRedirects`

Override how many upstream redirects the image fetcher follows. Each hop is re-validated against `allowedHosts` / `blockPrivateNetworks`. Default `5`. `0` rejects any redirect. The `src` is in context. Sync.

#### `image:url`

Rewrite the encrypted URL from `getImageUrl()` (and `<Image>`), typically to prepend a CDN origin. The context carries `src`, `filename`, and `original`. Return the URL unchanged to opt out per call. Sync.

```ts
'image:url': (url, { original }) => `https://cdn.example.com${url}`,
```

<Callout type="danger">
Only rewrite the origin/prefix. Never rewrite the last path segment (the `filename`). That segment is authenticated (bound as AAD to the token), so the image endpoint re-derives it and rejects (403) any request whose filename changed.
</Callout>

#### `image:fileFilter`

Controls which local imports become `ImportedImage` objects. Default `IMAGE_FILE_FILTER` matches png, jpg/jpeg, webp, avif, gif. Return a narrower or wider regex. The `target` is in context. Sync. Widening only decides which files reach the loader; each is still decoded by `Bun.Image`.

#### `image:localAssetFilename`

Rename the content-hashed file a local import emits. Default `<slug>-<hash>.<ext>`. Must be deterministic and a bare filename (no path separator or `..`). Sync.

#### `image:localAssetUrl`

Rewrite the `src` URL a local import resolves to. Default `${assetPrefix}/asset/<filename>`. Must be deterministic. Sync. A same-origin override must stay under `${assetPrefix}/asset/` as a single segment.

<Callout type="warning">

Returning an absolute (CDN) URL bypasses the built-in `/asset/` route and the local-disk shortcut. Pair it with `image:localAssetEmitted` to upload the bytes there.

</Callout>

#### `email:message`

Intercept every message sent through `Mochi.email()` right before the transport. Return a modified message, or `null` to **suppress** the send. The context carries the configured `transport` type. Async. See [Email](/docs/email/#intercepting-messages).

```ts
'email:message': (message, { transport }) => {
  if (transport === 'smtp' && process.env.STAGING) {
    return { ...message, to: ['qa@app.dev'], cc: undefined, bcc: undefined };
  }
  return { ...message, headers: { ...message.headers, 'List-Unsubscribe': '<mailto:unsub@app.dev>' } };
},
```

A suppressed send still emits `email:sent` with `transport: 'suppressed'`.

#### `captcha:bits`

Proof-of-work difficulty in leading zero bits. Resolved once at startup. Bounds-checked to 1–32. The context carries the raw `captcha` options and `configured`. Sync.

```ts
'captcha:bits': (def) => (process.env.NODE_ENV === 'test' ? 8 : def),
```

#### `captcha:minAgeMs`

The captcha timing floor. Applied per token. The context carries `bits`, `ageMs`, and `limitMs` (the returned floor must stay under `limitMs`). Sync. This is the only check that a submission took human time — see [The timing floor](/docs/captcha/#the-timing-floor).

#### `captcha:driftAllowanceMs`

Slack added to `maxAgeMs` before a token is refused as expired, to absorb clock skew across a multi-instance deploy. Resolved once. Sync. It widens the expiry side only, never the floor.

#### `captcha:solveBudgetMs`

How long the widget spends actively solving before it offers a retry. Resolved once and handed to the widget through `mintCaptcha()`. Must be positive and finite. Sync. Default `60_000`. A form can override it with the `solveBudgetMs` prop.

#### `queue:recoveryStallWarningMs`

How long a queue's [`recover`](/docs/queues/#recovery-on-start) callback may run before Mochi logs a warning naming it. Resolved once per queue that declares one. Sync. Default `30_000`. Return `0` to silence the warning.

#### `queue:lockDurationMs`

How long a job may run before its queue reclaims it. Resolved once per queue, after the per-queue [`lockDuration`](/docs/queues/#long-running-jobs) option. `explicit` says whether the value came from that option. Sync. Default and ceiling `1_800_000` (30 minutes).

```ts
'queue:lockDurationMs': (value, { explicit }) => (explicit ? value : 5 * 60_000),
```

The returned value must exceed the worst-case runtime of `process`. This filter is the last word on the lock, even over a `lockDuration` passed through the raw `bunqueue` escape hatch.
