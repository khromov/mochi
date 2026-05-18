---
title: 'API routes'
slug: api-routes
---

## API routes

`Mochi.api(handler)` registers a JSON endpoint. The handler receives a `MochiApiEvent` (`method`, `request`, `url`, `server`, `locals`) and **must** return a `Response` (or a `Promise<Response>`).

```ts
// file: src/routes.ts
import { Mochi } from 'mochi-framework';

export const routes = {
  '/health': Mochi.api(({ method }) => Response.json({ status: 'ok', method })),
};
```

Do **NOT** return a plain object or string from a `Mochi.api` handler; instead, wrap the value in `Response.json(...)` or the `json()` helper — anything else fails type-checking and the runtime won't serialize it for you.

### `MochiApiEvent`

The handler's argument carries only what the request needs — no params, no cookies. Pull request-scoped values from `getRequestContext()`:

```ts
// file: src/routes.ts
import { getRequestContext } from 'mochi-framework';

'/items/:id': Mochi.api(async () => {
  const { params, url, cookies } = getRequestContext();
  const tab = url.searchParams.get('tab') ?? 'overview';
  const session = cookies.get('session');
  return Response.json({ id: params.id, tab, session });
}),
```

Do **NOT** thread `params` through a custom argument; instead, read them from `getRequestContext().params` — the context is request-scoped via `AsyncLocalStorage`.

### Reading the request body

Use the standard `Request` body methods (`json()`, `text()`, `formData()`, `arrayBuffer()`). The body stream can only be consumed once.

```ts
// file: src/routes.ts
'/add': Mochi.api(async ({ method, request }) => {
  if (method !== 'POST') error(405, 'Method Not Allowed');
  const { a, b } = await request.json();
  return Response.json({ result: a + b });
}),
```

Do **NOT** call `request.json()` (or any other body method) more than once on the same request; instead, await it once, store the result, and reuse the value — a second read throws `TypeError: Body already used`.

### `json` (response helper)

Build a JSON `Response` with the right `Content-Type` via `json(data, init?)` from `mochi-framework`. Use it as a shorthand for `new Response(JSON.stringify(...), { headers: { 'Content-Type': 'application/json' } })`.

```ts
import { json } from 'mochi-framework';

Mochi.api(() => json({ ok: true }, { status: 201 }));
```

`init` accepts `status`, `statusText`, and `headers` — `Content-Type: application/json` is set for you.

### `error` (typed throw)

Use `error(status, message)` to throw a `MochiHttpError` from anywhere inside the handler — including helper functions called by it. The framework catches it and returns the canonical envelope `{ error: { message, status } }`.

```ts
import { error } from 'mochi-framework';

Mochi.api(async () => {
  const user = await loadUser();
  if (!user) error(404, 'Not found');
  return Response.json(user);
});
// → 404 { "error": { "message": "Not found", "status": 404 } }
```

`error` is typed `: never`, so TypeScript narrows control flow after the call — no manual `return` needed.

Do **NOT** throw a bare `Error` or any non-`MochiHttpError` value to signal a status code; instead, call `error(status, message)` — uncaught throws are coerced to `500 Internal Server Error` with a generic message and the original is logged server-side, never leaked to the client.

### `apiError` (typed return)

`apiError(status, message)` returns the same envelope as a plain `Response`, without throwing. Prefer it when the failure is part of the route's normal control flow and you want to keep returning instead of throwing.

```ts
import { apiError } from 'mochi-framework';

Mochi.api(async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body) return apiError(400, 'Invalid JSON');
  return Response.json({ ok: true });
});
// bad body → 400 { "error": { "message": "Invalid JSON", "status": 400 } }
```

### `MochiHttpError`

The error class `error()` throws. Catch it explicitly when you want to inspect or re-shape it; otherwise let it propagate to the framework.

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

Anything else thrown inside a `Mochi.api` handler — a database failure, a typo, a rejected promise — is returned as `500 Internal Server Error` with a generic message. The original error and stack are logged via `logger.error` with the method and path; the client never sees them.

```ts
Mochi.api(async () => {
  await db.query('SELECT …'); // throws ConnectionError
  return Response.json({ ok: true });
});
// → 500 { "error": { "message": "Internal Server Error", "status": 500 } }
// (real error + stack logged to stderr)
```

API routes never render the HTML error page and `handleError` is **not** called for them — the JSON envelope is the only contract.
