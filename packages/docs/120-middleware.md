---
title: 'Middleware (hooks)'
slug: middleware
description: 'Intercept and transform requests and responses with SvelteKit-style handle functions.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Middleware (hooks)

Middleware uses `Handle` functions registered through `Mochi.serve({ handle })`. Each handle receives `{ event, resolve }`, mutates `event` as needed, calls `resolve(event)` to continue the chain, and returns the resulting `Response`.

### `Handle`

A `Handle` is `async ({ event, resolve }) => Response`. `event` carries `{ request, url, server, locals, kind }`. `resolve(event)` invokes the next middleware or the final route handler and returns its `Response`.

```ts
// file: src/handle.ts
import type { Handle } from 'mochi-framework';

export const auth: Handle = async ({ event, resolve }) => {
  if (!event.request.headers.get('Authorization')) {
    return new Response('Unauthorized', { status: 401 });
  }
  return resolve(event);
};
```

<Callout type="warning">

**Await `resolve()` to post-process responses.** To inspect or modify the response, use `const response = await resolve(event)` and return it explicitly. Without `await`, your function completes before post-processing finishes, causing silent data loss and race conditions.

</Callout>

### `event.locals`

`event.locals` is a per-request object for passing data between middleware layers and into route handlers. Read it from any server-side context with `getRequestContext().locals`.

```ts
// file: src/handle.ts
import type { Handle } from 'mochi-framework';

export const attachUser: Handle = async ({ event, resolve }) => {
  event.locals.user = await loadUser(event.request);
  return resolve(event);
};
```

### `event.kind`

Every event carries a `kind` that describes what the framework is about to do with the request:

| Value        | When                                                                         |
| ------------ | ---------------------------------------------------------------------------- |
| `'page'`     | `Mochi.page` route (GET render or POST form action)                          |
| `'api'`      | `Mochi.api` route                                                            |
| `'asset'`    | Framework static asset (`.js` / `.css` client bundle or the dev stats route) |
| `'fallback'` | Unmatched URL — passed to your `fetch` handler                               |
| `'error'`    | Unmatched URL with no `fetch` configured — framework renders a 404           |

`kind` is set once at construction. An error thrown during a `Mochi.page` render stays `kind: 'page'`.

Use it to opt out of per-request work for framework assets:

```ts
// file: src/handle.ts
import type { Handle } from 'mochi-framework';

export const auth: Handle = async ({ event, resolve }) => {
  if (event.kind === 'asset') return resolve(event);
  if (!event.request.headers.get('Authorization')) {
    return new Response('Unauthorized', { status: 401 });
  }
  return resolve(event);
};
```

### `sequence`

Compose multiple handles into one with `sequence(...handlers)`. Handles run in order. The first handle's pre-processing runs first, and its post-processing runs last (nested-middleware semantics).

```ts
// file: src/index.ts
import { Mochi, sequence } from 'mochi-framework';
import { auth, logging, rateLimit } from './handle';

await Mochi.serve({
  handle: sequence(auth, logging, rateLimit),
  routes: {
    '/': Mochi.page('./src/Home.svelte'),
  },
});
```

### `resolve(event, opts)`

`resolve` accepts an options bag for post-processing the response:

- `transformPage({ html, done })` — rewrite the HTML body before it is sent. See [`transformPage`](/docs/transform-page/).
- `filterResponseHeaders(name, value)` — return `true` to keep a header, `false` to drop it.

```ts
// file: src/handle.ts
import type { Handle } from 'mochi-framework';

export const stripServerHeader: Handle = ({ event, resolve }) =>
  resolve(event, {
    filterResponseHeaders: (name) => name.toLowerCase() !== 'server',
  });
```

When composed with `sequence`, `transformPage` runs in **reverse** order (inner handle transforms first, outer wraps the result). `filterResponseHeaders` uses **first-defined-wins** — only the earliest handle's filter applies.

### `compress`

Built-in middleware factory for response compression. It negotiates gzip or brotli from the client's `Accept-Encoding`. Place it innermost in `sequence(...)` so it sees the body produced by the rest of the chain:

```ts
// file: src/index.ts
import { Mochi, sequence, compress } from 'mochi-framework';

await Mochi.serve({
  handle: sequence(auth, logging, compress()),
  routes,
});
```

Options:

- `methods` — the encodings the server is willing to use. Defaults to `['brotli', 'gzip']`. The client's `Accept-Encoding` picks the winner. The array order is only a tiebreak when the client expresses no preference.
- `brotliQuality` — brotli quality level `0..11`. Defaults to `4`. You should raise it only when the response is cached — higher levels may be too slow for per-request SSR.

```ts
sequence(auth, compress({ brotliQuality: 6 }));
sequence(auth, compress({ methods: ['gzip'] }));
```

`compress()` is a no-op in development, because the debug bar must inject itself into the HTML after the response is built. In production it adds `Vary: Accept-Encoding` and compresses compressible content types (`text/*`, `application/json`, `application/javascript`, `application/xml`, and others). A response that already declares `Content-Encoding` passes through untouched. Static framework assets also flow through `handle`, so `compress()` covers them. Other body-touching middleware must branch on `event.kind === 'asset'` when it needs to skip framework bundles.

### `noCache`

Built-in middleware that defaults `Cache-Control: no-cache` on `page` and `api` responses. A route that sets its own `Cache-Control` is left untouched, so opt-in caching works per route.

```ts
// file: src/index.ts
import { Mochi, sequence, noCache, compress } from 'mochi-framework';

await Mochi.serve({
  handle: sequence(noCache, compress()),
  routes,
});
```

`asset`, `fallback`, and `error` events pass through unchanged. WebSocket upgrades and SSE streams never reach the middleware.

<SeeItInAction
demos={[{ href: "/demos/request-id/", title: "Request ID", hook: "How request IDs work — every request gets a UUID v7 on getRequestContext().requestId that rides every lifecycle event for correlation." }]}
/>
