---
title: 'Standalone apps'
slug: standalone-apps
ogTitle: 'Static SPA builds with Mochi.standalone()'
description: 'Build a static, fully client-side app from your Mochi codebase with Mochi.standalone() — for packaging into Capacitor iOS/Android apps.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Standalone apps

<VersionNote since="0.10.0" />

`Mochi.standalone()` is the static counterpart of `Mochi.serve()`: instead of a server it emits a self-contained SPA — an `index.html` plus client JS/CSS — for packaging with [Capacitor](https://capacitorjs.com/) into iOS/Android apps. There is no SSR pipeline: an empty shell ships to the device, and every component mounts client-side.

Keep your full web app in `src/index.ts` as usual, and add a second entry, `src/app.ts`, for the standalone build. Both entries share the same `src/` — the same Svelte components and any isomorphic code:

```ts
// src/app.ts
import { Mochi } from 'mochi-framework';

await Mochi.standalone({
  port: 3338, // dev server only
  development: process.env.MODE === 'development',
  routes: {
    '/': Mochi.page('./src/Home.svelte'),
    '/todos/:id': Mochi.page('./src/TodoPage.svelte', {
      clientProps: async (params) => ({ todo: await fetchTodo(Number(params.id)) }),
    }),
  },
  notFound: Mochi.page('./src/NotFound.svelte'),
});
```

Running the entry does one of two things:

```sh
MODE=development bun src/app.ts   # dev server with full-page live reload
bun src/app.ts                    # writes the static app to dist/ and exits
```

`mochi-framework build --entry src/app.ts` also detects a standalone entry and produces the same static build.

Point Capacitor's `webDir` at `dist/` — every asset reference in the emitted `index.html` is relative, so the app works from Capacitor's webview origin as-is.

### Routing and clientProps

Standalone apps use a minimal hash router: `#/todos/42` renders the route matching `/todos/:id`, an empty hash means `/`, and static patterns win over `:param` patterns. Navigate with plain anchors:

```svelte
<a href="#/todos/{todo.id}">{todo.title}</a>
```

`clientProps` is `serverProps`' standalone sibling — `(params) => props`, resolved in the browser before the route's component mounts. When no route matches, the `notFound` page renders (or nothing, with a console warning).

`serverProps` and `actions` are rejected on standalone routes, and only `Mochi.page()` values are allowed in the routes map — API, WebSocket, and SSE routes need a server.

### Loading states

`clientProps` is often a network round-trip, and the router won't mount the route until it resolves. Configure a `loading` page and it mounts for the whole wait (navigating away mid-load discards the stale result):

```ts
await Mochi.standalone({
  routes: {/* … */},
  loading: Mochi.page('./src/Loading.svelte'),
});
```

The loading page renders with no props and may not declare `clientProps` of its own.

### Degrading offline

A packaged app must expect to run with no connectivity. A useful pattern: have your data functions resolve to data plus an `offline` flag instead of throwing, falling back to bundled (or cached) data, and let the page render an offline notice. Distinguish "the server answered with an error" from "the network is down" — `fetchDevalue` throws `MochiFetchError` only for the former:

```ts
export async function fetchTodo(id: number): Promise<{ todo: Todo | null; offline: boolean }> {
  try {
    return { todo: await fetchDevalue<Todo>(`${API_ORIGIN}/api/todos/${id}`), offline: false };
  } catch (err) {
    if (err instanceof MochiFetchError) {
      return { todo: null, offline: false }; // a 404 is a real "not found", not connectivity
    }
    return { todo: getTodo(id), offline: true }; // network down — show bundled data + a notice
  }
}
```

### Sharing components between both apps: `isStandalone`

A component used by both your `Mochi.serve()` web app and your standalone app can't hardcode hash links — the web app routes on real paths. Import the compile-time `isStandalone` flag from `mochi-framework` to branch. It is `true` only inside a standalone client build, and `false` during SSR and in `Mochi.serve()` island bundles:

```ts
import { isStandalone } from 'mochi-framework';

// #/todos/2 in the standalone app, /todos/2 in the web app
export function appHref(path: string): string {
  return isStandalone ? `#${path}` : path;
}
```

```svelte
<a href={appHref(`/todos/${todo.id}`)}>{todo.title}</a>
```

Register the matching route in **both** entries — `clientProps` in `src/app.ts`, `serverProps` in `src/index.ts` — pointing at the same component:

```ts
// src/app.ts (standalone)
'/todos/:id': Mochi.page('./src/TodoPage.svelte', { clientProps: async (params) => ({ todo: await fetchTodo(+params.id) }) }),

// src/index.ts (web)
'/todos/:id': Mochi.page('./src/TodoPage.svelte', { serverProps: (_req, params) => ({ todo: getTodo(+params.id) }) }),
```

### Reusing your data layer with Mochi.apiDevalue()

`Mochi.apiDevalue()` is `Mochi.api()` with [devalue](https://github.com/sveltejs/devalue) on top: the handler returns a plain value and the framework serializes it, so Dates, Maps, Sets, and BigInts survive the wire. On the consuming side, `fetchDevalue()` fetches and revives:

```ts
// src/index.ts — the web app exposes the shared data function
'/api/todos/:id': Mochi.apiDevalue(({ params }) => getTodo(Number(params.id))),
```

```ts
// shared client code — the standalone app consumes it
import { fetchDevalue } from 'mochi-framework';

const todo = await fetchDevalue<Todo>(`${API_ORIGIN}/api/todos/${id}`);
```

A non-2xx response throws `MochiFetchError` with the HTTP `status`. The standalone app runs on its own origin (the dev server, or Capacitor's webview), so the web app must allow CORS on its API routes — and cross-origin calls must hit the exact declared path, with no trailing slash (`trailingSlash` applies to page routes only, and a redirect would carry no CORS headers anyway):

```ts
// src/index.ts
handle: async ({ event, resolve }) => {
  const response = await resolve(event);
  if (event.url.pathname.startsWith('/api/')) {
    response.headers.set('Access-Control-Allow-Origin', '*');
  }
  return response;
},
```

<Callout type="warning">

**Version your API.** Users keep old app builds installed long after you deploy new server code — an endpoint you change or remove breaks every device that hasn't updated. Keep `Mochi.api()`/`Mochi.apiDevalue()` endpoints backward-compatible (add fields, don't repurpose them; prefer versioned paths like `/api/v1/…` for breaking changes). Mochi doesn't manage this for you yet — it's on you.

</Callout>

### Options

```ts
await Mochi.standalone({
  routes, // Mochi.page() values only (required)
  notFound: Mochi.page('…'), // rendered when no route matches
  loading: Mochi.page('…'), // rendered while a route's clientProps resolve
  development: false, // true (default): dev server; false: static build
  htmlShell: './src/app-shell.html', // shell file or inline template, same {{mochi.*}} placeholders
  outDir: './dist', // Capacitor's webDir
  publicDir: './public', // copied into the build verbatim
  port: 3338, // dev server
  additionalWatchPaths: [], // extra dev-server watch roots beyond src/, publicDir, and the shell
  logger: { level: 'info' },
});
```

The shell uses the same `{{mochi.head}} {{mochi.css}} {{mochi.body}} {{mochi.script}}` placeholders as [custom HTML shells](/docs/custom-html-shell/); the body slot receives the `<div id="mochi-app">` mount target and the script slot the app bundle.

### What doesn't work in standalone apps

- **All `mochi:*` directives are stripped.** Everything is client-rendered anyway, so `mochi:hydrate*` and `mochi:clientOnly*` are meaningless — a shared component carrying them simply renders inline. `mochi:defer*` server islands are also stripped in this version (fetching them from a remote Mochi server is planned).
- **No server request machinery**: `serverProps`, form `actions`, `getRequestContext()`, the server cookie jar, and `Mochi.ws`/`Mochi.sse`/`Mochi.api` routes all need `Mochi.serve()`. Fetch data with `clientProps` instead.
- **Server-only imports fail the build.** `app.ts` and everything it pulls in must be isomorphic — a `.server.ts` import compiles to a throwing stub, exactly like in island client bundles.
