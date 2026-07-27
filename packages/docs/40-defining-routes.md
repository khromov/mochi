---
title: 'Defining routes'
slug: defining-routes
description: 'Register pages, APIs, WebSockets, SSE endpoints, and file routes using the programmatic routes record.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Defining routes

Routes are a `Record<string, MochiRouteValue>` passed to `Mochi.serve({ routes })`. Each key is a Bun router pattern; each value is built from one of the five `Mochi.*` helpers.

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  port: 3333,
  development: process.env.MODE === 'development',
  routes: {
    '/': Mochi.page('./src/Home.svelte'),
    '/about': Mochi.page('./src/About.svelte', { serverProps: { title: 'About' } }),
    '/health': Mochi.api(() => Response.json({ status: 'ok' })),
    '/ws/chat': Mochi.ws({
      message(ws, msg) {
        ws.send(String(msg));
      },
    }),
    '/sse/time': Mochi.sse((stream) => {
      stream.send(new Date().toISOString());
    }),
  },
});
```

### Route parameters

Patterns use Bun's router syntax: `:name` for a single segment, `*` for a wildcard tail. Read matched values from `getRequestContext().params`:

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/posts/:slug': Mochi.page('./src/Post.svelte'),
  },
});
```

```svelte
<!-- file: src/Post.svelte -->
<script>
  import { getRequestContext } from 'mochi-framework';
  const { params } = getRequestContext();
</script>

<h1>{params.slug}</h1>
```

### `Mochi.page`

Register an SSR Svelte page via `Mochi.page(componentPath, { serverProps?, actions? })`. `componentPath` is resolved relative to the project root.

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/about': Mochi.page('./src/About.svelte', {
      serverProps: { title: 'About' },
    }),
  },
});
```

`serverProps` is either a plain object or a `(req, params) => props` resolver (sync or async). The resolved object is passed to the component as `$props`.

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/posts/:slug': Mochi.page('./src/Post.svelte', {
      serverProps: async (_req, params) => ({
        post: await loadPost(params.slug),
      }),
    }),
  },
});
```

```svelte
<!-- file: src/Post.svelte -->
<script>
  let { post } = $props();
</script>

<h1>{post.title}</h1>
```

`actions` is a `MochiFormActions` map handling POST submissions to the route. See `Mochi.page actions` for the action contract.

<Callout type="warning">

**Avoid `form` as a prop name.** When `actions` is declared, `form` is reserved for the action result. Return any other prop name from `serverProps` to avoid a runtime error.

</Callout>

### `Mochi.api`

Register a JSON endpoint via `Mochi.api(handler)`. The handler receives a `MochiApiEvent` (`method`, `request`, `url`, `server`, `locals`, `params`, `cookies`) and returns a `Response`.

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/health': Mochi.api(({ method }) => Response.json({ status: 'ok', method })),
  },
});
```

Throw `MochiHttpError` (via `error(status, message)`) for non-2xx responses; uncaught throws become `500 Internal Server Error`. See `API routes` for the full error contract.

### `Mochi.ws`

Register a WebSocket endpoint via `Mochi.ws(handlers, originOptions?)`. `message` is required; `upgrade`, `open`, `close`, `drain` are optional. Return data from `upgrade` (or `false` to reject) to attach to `ws.data.user`. Handshakes require an exact same-origin `Origin` header by default; use the optional second argument to configure additional trusted origins or non-browser clients.

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/ws/chat': Mochi.ws({
      open(ws) {
        ws.subscribe('chat');
      },
      message(ws, msg) {
        ws.publish('chat', String(msg));
      },
    }),
  },
});
```

See `WebSocket routes` for `upgrade` semantics and typed `ws.data.user`.

### `Mochi.sse`

Register a Server-Sent Events stream via `Mochi.sse(handler)`. The handler receives a `MochiSseStream` with `send`, `close`, and `onClose`.

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/sse/time': Mochi.sse((stream) => {
      const interval = setInterval(() => stream.send(new Date().toISOString()), 1000);
      stream.onClose(() => clearInterval(interval));
    }),
  },
});
```

<Callout type="warning">

**Tear down anything you open per connection.** Each client opens its own timers, intervals, and event-bus subscriptions — like the `setInterval` above. Without a matching `onClose` teardown they keep running after the client disconnects and leak.

```ts
Mochi.sse((stream) => {
  const unsubscribe = chat.subscribe((msg) => stream.send(msg));
  stream.onClose(unsubscribe); // fires on disconnect or stream.close()
});
```

</Callout>

### `Mochi.file`

Serve a single file from disk via `Mochi.file(source)`. `source` is either a string path or a resolver `(req, params) => string` (sync or async) that returns the path. The `Content-Type` is inferred from the file extension; `HEAD` is handled automatically (headers only, empty body). Paths are resolved relative to the working directory; absolute paths work too, but every resolved path must stay inside the app root (the working directory) — anything outside returns a `404`.

```ts
// file: src/index.ts
import { Mochi, error } from 'mochi-framework';

await Mochi.serve({
  routes: {
    // Static path.
    '/report': Mochi.file('./files/report.pdf'),

    // Resolver — pick the file per request from the route param.
    '/files/:name': Mochi.file((req, params) => {
      if (!/^[a-z0-9-]+$/.test(params.name)) {
        error(404, 'Not found');
      }
      return `./files/${params.name}.pdf`;
    }),
  },
});
```

A missing file returns a plain-text `404`; a resolver may also `error(404, …)` to force one. The file is read from disk on every request, so files written or deleted at runtime are picked up immediately. `Mochi.file` passes through global `handle` middleware, but does **not** support `Range` requests or generate caching headers (`ETag`/`Cache-Control`) — reach for `Mochi.api` if you need full control over the response.

<Callout type="danger">

Route params are URL-decoded before they reach your resolver, so `params.name` can contain `../` (e.g. from `/files/..%2f..%2fsecret`). Mochi refuses to serve any path that resolves outside the app root, but that guard doesn't know which files _inside_ the root are private — `.env`, source files, and config are all fair game for a traversal that stays within the project. Always validate params against an allow-list or strict pattern, as above.

</Callout>

### HEAD requests

Every `Mochi.page` and `Mochi.api` route answers `HEAD` automatically by running its `GET`/handler logic and stripping the response body. Status and headers match the equivalent `GET`, and `Content-Length` is set to the byte length the `GET` body would have had. No per-route opt-in is needed — this also covers static assets and the `404` fallback.

<Callout type="info">
  `Mochi.sse` is GET-only: a `HEAD` is answered with `405 Method Not Allowed` (`Allow: GET`) without opening a stream, since a body-less probe of a stream endpoint can't reflect the real headers or run the same auth/observability path. `Mochi.ws` routes are upgrade-only and likewise do not handle `HEAD`.
</Callout>

### Static files

Files under `./public` are served automatically; no route entry is needed. They're read straight from that directory in both development and production — nothing is copied into `.mochi/`, so the directory has to ship with your deploy. A user-defined route always wins over a same-path public file. See `Serve options` for `publicDir`.

<SeeItInAction
demos={[
{ href: "/demos/hello-world/", title: "Hello World", hook: "How server-side rendering works — a Mochi.page() renders Svelte on the server and ships zero JavaScript." },
{ href: "/demos/api/", title: "API Endpoints", hook: "How API routes work — define JSON endpoints with Mochi.api(), tested live against the running server." },
{ href: "/demos/file/", title: "File Routes", hook: "How file routes work — serve a file from disk with Mochi.file(), as a static path or a per-request resolver." },
]}
/>
