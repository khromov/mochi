---
title: 'API routes'
slug: api-routes
description: 'Register JSON endpoints with Mochi.api() that receive a request event and return a Response.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## API routes

`Mochi.api(handler)` registers a JSON endpoint. The handler receives a `MochiApiEvent` (`method`, `request`, `url`, `server`, `locals`, `params`, `cookies`) and **must** return a `Response` (or a `Promise<Response>`).

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/health': Mochi.api(({ method }) => Response.json({ status: 'ok', method })),
  },
});
```

### `MochiApiEvent`

Destructure `params` and `cookies` off the event. They mirror what `Mochi.page` form-action handlers receive:

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/items/:id': Mochi.api(({ url, params, cookies }) => {
      const tab = url.searchParams.get('tab') ?? 'overview';
      const session = cookies.get('session');
      return Response.json({ id: params.id, tab, session });
    }),
  },
});
```

`getRequestContext()` exposes the same values plus `requestId`, `islandProps`, and `getClientAddress()`. Use it from helper functions that are not passed the event.

### Reading the request body

Use the standard `Request` body methods (`json()`, `text()`, `formData()`, `arrayBuffer()`). The body stream can be consumed once.

```ts
// file: src/index.ts
import { Mochi, error } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/add': Mochi.api(async ({ method, request }) => {
      if (method !== 'POST') error(405, 'Method Not Allowed');
      const { a, b } = await request.json();
      return Response.json({ result: a + b });
    }),
  },
});
```

<Callout type="warning">

**Read the request body once.** Calling `request.json()` (or any body method) a second time throws `TypeError: Body already used`. Await it once, store the result, and reuse the value.

</Callout>

### `json` (response helper)

Build a JSON `Response` with the right `Content-Type` through `json(data, init?)` from `mochi-framework`.

```ts
import { json } from 'mochi-framework';

Mochi.api(() => json({ ok: true }, { status: 201 }));
```

`init` accepts `status`, `statusText`, and `headers`. Mochi sets `Content-Type: application/json` for you.

### `error` (typed throw)

Use `error(status, message)` to throw a `MochiHttpError` from anywhere inside the handler, including helper functions. The framework catches it and returns the canonical envelope `{ error: { message, status } }`.

```ts
import { error } from 'mochi-framework';

Mochi.api(async () => {
  const user = await loadUser();
  if (!user) error(404, 'Not found');
  return Response.json(user);
});
// → 404 { "error": { "message": "Not found", "status": 404 } }
```

`error` is typed `: never`, so TypeScript narrows control flow after the call.

<Callout type="danger">

**Uncaught errors become 500s.** Any throw that is not a `MochiHttpError` is caught, coerced to `500 Internal Server Error` with a generic message, and logged server-side. Use `error(status, message)` to return intended status codes.

</Callout>

### `apiError` (typed return)

`apiError(status, message)` returns the same envelope as a plain `Response`, without throwing. Use it when the failure is part of the route's normal control flow.

```ts
import { apiError } from 'mochi-framework';

Mochi.api(async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body) return apiError(400, 'Invalid JSON');
  return Response.json({ ok: true });
});
```

### `MochiHttpError`

The error class `error()` throws. Catch it explicitly when you want to inspect or re-shape it. Otherwise let it propagate.

```ts
import { MochiHttpError } from 'mochi-framework';

try {
  await mayThrow();
} catch (err) {
  if (err instanceof MochiHttpError && err.status === 404) {
    return apiError(404, 'Gone');
  }
  throw err;
}
```

### Uncaught errors

Anything else thrown inside a `Mochi.api` handler — a database failure, a typo, a rejected promise — returns `500 Internal Server Error` with a generic message. Mochi logs the original error and stack. The client never sees them.

API routes never render the HTML error page, and `handleError` is **not** called for them. The JSON envelope is the only contract.

<SeeItInAction
demos={[{ href: "/demos/api/", title: "API Endpoints", hook: "How API routes work — define JSON endpoints with Mochi.api(), tested live against the running server." }]}
/>
