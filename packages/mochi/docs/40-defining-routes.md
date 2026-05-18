---
title: 'Defining routes'
slug: defining-routes
---

## Defining routes

Routes are a `Record<string, MochiRouteValue>` passed to `Mochi.serve({ routes })`. Each key is a Bun router pattern; each value is built from one of the four `Mochi.*` helpers.

```ts
// file: src/routes.ts
import { Mochi } from 'mochi-framework';

export const routes = {
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
};
```

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';
import { routes } from './routes';

await Mochi.serve({
  port: 3333,
  development: process.env.MODE === 'development',
  routes,
});
```

### Route parameters

Patterns use Bun's router syntax: `:name` for a single segment, `*` for a wildcard tail. Read matched values from `getRequestContext().params`:

```ts
// file: src/routes.ts
'/posts/:slug': Mochi.page('./src/Post.svelte'),
```

```svelte
<!-- file: src/Post.svelte -->
<script>
  import { getRequestContext } from 'mochi-framework';
  const { params } = getRequestContext();
</script>

<h1>{params.slug}</h1>
```

Do **NOT** thread `params` through props from `serverProps`; instead, call `getRequestContext()` directly in the component or any helper it imports — the context is request-scoped via `AsyncLocalStorage`.

### `Mochi.page`

Register an SSR Svelte page via `Mochi.page(componentPath, { serverProps?, actions? })`. `componentPath` is resolved relative to the project root.

```ts
// file: src/routes.ts
'/about': Mochi.page('./src/About.svelte', {
  serverProps: { title: 'About' },
}),
```

`serverProps` is either a plain object or a `(req, params) => props` resolver (sync or async). The resolved object is passed to the component as `$props`.

```ts
// file: src/routes.ts
'/posts/:slug': Mochi.page('./src/Post.svelte', {
  serverProps: async (_req, params) => ({
    post: await loadPost(params.slug),
  }),
}),
```

```svelte
<!-- file: src/Post.svelte -->
<script>
  let { post } = $props();
</script>

<h1>{post.title}</h1>
```

`actions` is a `MochiFormActions` map handling POST submissions to the route. See `Mochi.page actions` for the action contract.

Do **NOT** return a prop named `form` from `serverProps` when `actions` is declared; the name is reserved for the form action result and the route will throw at render time.

### `Mochi.api`

Register a JSON endpoint via `Mochi.api(handler)`. The handler receives a `MochiApiEvent` (`method`, `request`, `url`, `server`, `locals`) and returns a `Response`.

```ts
// file: src/routes.ts
'/health': Mochi.api(({ method }) => Response.json({ status: 'ok', method })),
```

Throw `MochiHttpError` (via `error(status, message)`) for non-2xx responses; uncaught throws become `500 Internal Server Error`. See `API routes` for the full error contract.

Do **NOT** render HTML from `Mochi.api`; instead, use `Mochi.page` for HTML routes — API routes never go through the error page or `handleError`.

### `Mochi.ws`

Register a WebSocket endpoint via `Mochi.ws(handlers)`. `message` is required; `upgrade`, `open`, `close`, `drain` are optional. Return data from `upgrade` (or `false` to reject) to attach to `ws.data.user`.

```ts
// file: src/routes.ts
'/ws/chat': Mochi.ws({
  open(ws) {
    ws.subscribe('chat');
  },
  message(ws, msg) {
    ws.publish('chat', String(msg));
  },
}),
```

See `WebSocket routes` for `upgrade` semantics and typed `ws.data.user`.

### `Mochi.sse`

Register a Server-Sent Events stream via `Mochi.sse(handler)`. The handler receives a `MochiSseStream` with `send`, `close`, and `onClose`.

```ts
// file: src/routes.ts
'/sse/time': Mochi.sse((stream) => {
  const interval = setInterval(() => stream.send(new Date().toISOString()), 1000);
  stream.onClose(() => clearInterval(interval));
}),
```

Do **NOT** forget `onClose` cleanup when you allocate per-connection resources; instead, register a teardown so timers/subscriptions don't leak when the client disconnects.

### Static files

Files under `./public` are served automatically; no route entry is needed. A user-defined route always wins over a same-path public file. See `Serve options` for `publicDir`.
