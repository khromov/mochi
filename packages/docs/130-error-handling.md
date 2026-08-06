---
title: 'Error handling'
slug: error-handling
description: 'Configure a custom error page and control how uncaught errors render to the client.'
---

<script>
  import { Image } from 'mochi-framework/image';
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
  import errorPage from './images/error-page.png';
</script>

## Error handling

Mochi renders an HTML error page for any uncaught error that escapes a page render: top-level SSR throws, `error(status, ...)` from `serverProps` or actions, malformed form bodies, unknown form actions, and unmatched routes. API routes return a JSON envelope instead. Island-level boundaries are scoped to hydratable islands — see [Error boundaries](/docs/error-boundaries/).

<figure>
  <Image src={errorPage} size="doc" width={errorPage.width} height={errorPage.height} alt="The built-in error page: a large 500 above the message Internal Server Error, a Go home link, and a Stack trace section showing the thrown error" />
  <figcaption>The built-in error page, shown when <code>errorPage</code> is omitted. The stack trace renders only under <code>development: true</code>.</figcaption>
</figure>

Configure the page with `errorPage` on `Mochi.serve()`. Omit it to use the built-in component.

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  errorPage: './src/Error.svelte',
  routes: {
    '/': Mochi.page('./src/Home.svelte'),
  },
});
```

### `errorPage`

The component receives one `error` prop typed by `MochiErrorProps`.

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
| `message` | Human-readable message, safe to render                            |
| `stack`   | Stack trace, populated only when `development: true`, else absent |

Default behavior without `errorPage`:

- Unmatched routes → `404 Not Found`.
- Uncaught throws in `serverProps`, page render, or an action handler → `500 Internal Server Error`.
- `error(status, message)` thrown from any of these → that exact `status` and `message`.

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

await Mochi.serve({
  errorPage: './src/Error.svelte',
  handleError,
  routes: {
    '/': Mochi.page('./src/Home.svelte'),
  },
});
```

Return one of:

- `{ status, message }` — override either field passed to the error component.
- a `Response` — short-circuit rendering (useful for redirects).
- `void` — keep the defaults.

`error` is `null` when the condition did not come from a throw (unmatched routes, unknown form actions). Inspect it before forwarding so benign 4xx cases do not page on-call.

<Callout type="warning">

**API routes bypass `handleError`.** The hook fires for page routes only. Handle `Mochi.api` failures inside the route with `error()` or `apiError()`:

```ts
Mochi.api(async () => {
  const data = await load();
  if (!data) return apiError(404, 'Not found');
  return json(data);
});
```

</Callout>

If the hook itself throws, Mochi logs the secondary error and renders the error page with the original `status` and `message`.

### API error envelope

`Mochi.api` routes return `{ "error": { "message", "status" } }` with the matching status code. Use `MochiHttpError` (typed throw via `error()`) or `apiError()` (typed return) to produce the envelope. See [API routes](/docs/api-routes/).

<Callout type="warning">

**Use `error(status, message)` to signal status codes.** A bare `throw new Error()` is coerced to a generic 500. Only `error(status, message)` returns the typed error envelope the framework expects.

</Callout>

### Fallback behavior

If your `errorPage` throws during render, Mochi returns a plain-text response mentioning both the original error and the secondary render failure. The error page cannot crash the server.

<SeeItInAction
demos={[{ href: "/demos/error/", title: "Error Handling", hook: "How error handling works — catch render errors and unmatched routes via Mochi.serve()'s errorPage option and the handleError hook." }]}
/>
