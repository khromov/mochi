---
title: 'Error handling'
slug: error-handling
description: 'Configure a custom error page and control how uncaught errors are rendered to the client.'
---

## Error handling

Mochi renders an HTML error page for any uncaught error escaping a page render — top-level SSR throws, `error(status, ...)` from `serverProps` or actions, malformed form bodies, unknown form actions, and unmatched routes. API routes are not affected; they return a JSON envelope. Island-level boundaries are scoped to hydratable islands — see `Error boundaries`.

Configure the page via `errorPage` on `Mochi.serve()`. Omit it to use the built-in minimal component.

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';
import { routes } from './routes';

await Mochi.serve({
  errorPage: './src/Error.svelte',
  routes,
});
```

Do **NOT** rely on `<svelte:boundary>` to catch a top-level page throw; instead, let it surface to `errorPage` — Mochi does not wrap the page root in a boundary. Author your own `<svelte:boundary>` only when a section should degrade gracefully.

### `errorPage`

The component receives a single `error` prop typed by `MochiErrorProps`.

```svelte
<!-- file: src/Error.svelte -->
<script lang="ts">
  import type { MochiErrorProps } from 'mochi-framework';
  let { error }: MochiErrorProps = $props();
</script>

<h1>{error.status}</h1>
<p>{error.message}</p>
{#if error.stack}<pre>{error.stack}</pre>{/if}
```

| Field     | Description                                                       |
| --------- | ----------------------------------------------------------------- |
| `status`  | HTTP status — `404`, `500`, or whatever was passed to `error()`   |
| `message` | Human-readable message — safe to render                           |
| `stack`   | Stack trace; populated only when `development: true`, else absent |

Default behaviour without `errorPage`:

- Unmatched routes — `404 Not Found`.
- Uncaught throws in `serverProps`, page render, or an action handler — `500 Internal Server Error`.
- `error(status, message)` thrown from any of the above — that exact `status` and `message`.

### `handleError`

Fires whenever the error page is about to render. Use it to log, forward to error tracking, or sanitize the message the user sees.

```ts
// file: src/index.ts
import type { HandleError } from 'mochi-framework';

const handleError: HandleError = ({ error, event, status, message }) => {
  if (error) tracker.capture(error, { path: event.url.pathname });
  if (status === 404) return Response.redirect(new URL('/', event.url), 302);
  if (status >= 500) return { status, message: 'Something went wrong.' };
};

await Mochi.serve({ errorPage: './src/Error.svelte', handleError, routes });
```

Return one of:

- `{ status, message }` — override either field passed to the error component.
- a `Response` — short-circuit rendering (useful for redirects or custom responses).
- `void` — keep the defaults.

`error` is `null` when the condition didn't originate from a throw (unmatched routes, unknown form actions). Inspect it before forwarding so benign 4xx cases don't page on-call.

Do **NOT** use `handleError` for API routes; instead, handle API failures inside the `Mochi.api` handler — `handleError` is never called for `Mochi.api` responses.

If the hook itself throws, Mochi logs the secondary error and renders the error page with the original `status` and `message`.

### API error envelope

`Mochi.api` routes never render the HTML error page. Failures return `{ "error": { "message", "status" } }` with the matching status code. Use `MochiHttpError` (typed throw via `error()`) or `apiError()` (typed return) to produce the envelope.

```ts
// file: src/routes.ts
import { Mochi, error, apiError } from 'mochi-framework';

export const routes = {
  '/users/:id': Mochi.api(async () => {
    const user = await loadUser();
    if (!user) error(404, 'Not found');
    return Response.json(user);
  }),
  '/parse': Mochi.api(async ({ request }) => {
    const body = await request.json().catch(() => null);
    if (!body) return apiError(400, 'Invalid JSON');
    return Response.json({ ok: true });
  }),
};
```

Uncaught throws inside a `Mochi.api` handler are coerced to `500 Internal Server Error` with a generic message; the original error and stack are logged via `log.error` and never leaked to the client. See `API routes` for the full contract.

Do **NOT** throw a bare `Error` to signal a status code; instead, call `error(status, message)` so the framework returns the typed envelope.

### Fallback behaviour

If the user's `errorPage` itself throws during render, Mochi returns a plain-text response that mentions both the original error and the secondary render failure — the error page cannot crash the server.
