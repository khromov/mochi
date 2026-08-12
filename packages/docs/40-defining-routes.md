---
title: 'Defining routes'
slug: defining-routes
description: 'Register pages, APIs, WebSockets, SSE endpoints, and file routes with the programmatic routes record.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Defining routes

Routes are a `Record<string, MochiRouteValue>` passed to `Mochi.serve({ routes })`. Each key is a Bun router pattern. Each value comes from one of the five `Mochi.*` helpers.

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

Use `:name` for a single segment and `*` for a wildcard tail. Read matched values from `getRequestContext().params`.

```svelte
<!-- file: src/Post.svelte -->
<script>
  import { getRequestContext } from 'mochi-framework';
  const { params } = getRequestContext();
</script>

<h1>{params.slug}</h1>
```

<Callout type="info">

A `:param` always captures the whole segment — you can't put literal text beside it. Bun reads `/profile/@:user` as literal text, so `/profile/@bob` never matches. Match `/profile/:user` instead; the sigil comes along in the param (`params.user === '@bob'`), and `/profile/bob` matches too. Guard and strip inline when you only want the prefixed form:

```ts
serverProps: (_req, params) => {
  if (!params.user.startsWith('@')) error(404);
  return { username: params.user.slice(1) };
};
```

</Callout>

### `Mochi.page`

Register an SSR Svelte page with `Mochi.page(componentPath, { serverProps?, actions? })`. `componentPath` resolves relative to the project root.

`serverProps` is a plain object or a `(req, params) => props` resolver (sync or async). The resolved object reaches the component as `$props`.

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

`actions` is a `MochiFormActions` map that handles POST submissions to the route.

<Callout type="warning">

**Do not use `form` as a prop name.** When `actions` is declared, `form` is reserved for the action result. Return any other prop name from `serverProps` to avoid a runtime error.

</Callout>

#### Redirecting from serverProps

<VersionNote since="0.10.0" message="Returning redirect() from serverProps requires mochi-framework 0.10.0." />

A `serverProps` resolver may return `redirect(status, location)` instead of props — the page render is skipped and the response carries the redirect. Use it for auth gates:

```ts
// file: src/index.ts
import { Mochi, redirect } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/settings': Mochi.page('./src/Settings.svelte', {
      serverProps: (req) => {
        const user = currentUser(req);
        if (!user) return redirect(303, '/login');
        return { user };
      },
    }),
  },
});
```

The return type is `MochiRedirect`. Returning `fail()` or `success()` from `serverProps` is a runtime error — those are form-action results.

### `Mochi.api`

Register a JSON endpoint with `Mochi.api(handler)`. The handler receives a `MochiApiEvent` (`method`, `request`, `url`, `server`, `locals`, `params`, `cookies`) and returns a `Response`.

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/health': Mochi.api(({ method }) => Response.json({ status: 'ok', method })),
  },
});
```

Throw `MochiHttpError` with `error(status, message)` for non-2xx responses. An uncaught throw becomes `500 Internal Server Error`. See [API routes](/docs/api-routes/).

### `Mochi.ws`

Register a WebSocket endpoint with `Mochi.ws(handlers)`. `message` is required. `upgrade`, `open`, `close`, and `drain` are optional. Return data from `upgrade` (or `false` to reject) to attach to `ws.data.user`.

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

See [WebSocket routes](/docs/websocket-routes/).

### `Mochi.sse`

Register a Server-Sent Events stream with `Mochi.sse(handler)`. The handler receives a `MochiSseStream` with `send`, `close`, and `onClose`.

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

**Tear down anything you open per connection.** Each client opens its own timers, intervals, and subscriptions. Without a matching `onClose` teardown they keep running after the client disconnects and leak memory.

```ts
Mochi.sse((stream) => {
  const unsubscribe = chat.subscribe((msg) => stream.send(msg));
  stream.onClose(unsubscribe); // fires on disconnect or stream.close()
});
```

</Callout>

### `Mochi.file`

Serve one file from disk with `Mochi.file(source)`. `source` is a string path or a `(req, params) => string` resolver (sync or async). Mochi infers `Content-Type` from the file extension and answers `HEAD` automatically. Paths resolve relative to the working directory. Every resolved path must stay inside the app root. A path outside returns `404`.

```ts
// file: src/index.ts
import { Mochi, error } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/report': Mochi.file('./files/report.pdf'),

    '/files/:name': Mochi.file((req, params) => {
      const name = params.name;
      if (!name || !/^[a-z0-9-]+$/.test(name)) {
        error(404, 'Not found');
      }
      return `./files/${name}.pdf`;
    }),
  },
});
```

Mochi reads the file from disk on every request, so files written or deleted at runtime are picked up at once. `Mochi.file` does not support `Range` requests, caching headers, or middleware. Use `Mochi.api` when you need full control over the response.

<Callout type="danger">

Route params are URL-decoded before they reach your resolver, so `params.name` can contain `../` (for example, from `/files/..%2f..%2fsecret`). Mochi refuses any path that resolves outside the app root, but that guard does not protect private files inside the root, such as `.env`, source, and config. Always validate params against an allow-list or a strict pattern, as above.

</Callout>

### HEAD requests

Every `Mochi.page` and `Mochi.api` route answers `HEAD` automatically. Mochi runs the `GET` logic and strips the body. Status and headers match the `GET`, and `Content-Length` is set to the `GET` body length. This also covers static assets and the `404` fallback.

<Callout type="info">

`Mochi.sse` is GET-only: a `HEAD` returns `405 Method Not Allowed` (`Allow: GET`) without opening a stream. `Mochi.ws` routes are upgrade-only and do not handle `HEAD`.

</Callout>

### Static files

Mochi serves files under `./public` automatically, in development and production, so the directory must ship with your deploy. A user-defined route wins over a same-path public file. See [Serve options](/docs/serve-options/) for `publicDir`.

<SeeItInAction
demos={[
{ href: "/demos/hello-world/", title: "Hello World", hook: "How server-side rendering works — a Mochi.page() renders Svelte on the server and ships zero JavaScript." },
{ href: "/demos/api/", title: "API Endpoints", hook: "How API routes work — define JSON endpoints with Mochi.api(), tested live against the running server." },
{ href: "/demos/file/", title: "File Routes", hook: "How file routes work — serve a file from disk with Mochi.file(), as a static path or a per-request resolver." },
]}
/>
