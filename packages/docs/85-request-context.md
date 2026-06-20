---
title: 'Request context'
slug: request-context
description: 'Access the current URL, route params, cookies, and locals from any server-side code — plus the isomorphic url export that works on the client too.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Request context

Inside components and server-side helpers, import context values directly from `mochi-framework`:

```ts
import { url, params, cookies, locals } from 'mochi-framework';
```

Each export is a proxy that reads from the current request's `AsyncLocalStorage` context on every property access — no need to thread values through props.

### `url`

The current page URL as a standard [`URL`](https://developer.mozilla.org/en-US/docs/Web/API/URL) object.

```svelte
<!-- file: src/Post.svelte -->
<script>
  import { url } from 'mochi-framework';

  const page = Number(url.searchParams.get('page') ?? '1');
</script>

<p>Current path: {url.pathname}</p>
```

`url` is **isomorphic** — it works on both server and client:

- **Server:** proxies `getRequestContext().url`, the parsed request URL.
- **Client:** proxies `new URL(window.location.href)`, constructed fresh on each access so it always reflects the current browser URL (including after `pushState` / `replaceState`).

<Callout type="info">
Because the proxy constructs a fresh URL on every access, destructured values like `const {'{'} pathname {'}'} = url` are snapshots — they won't update if the URL changes later. Access `url.pathname` directly when you need the live value.
</Callout>

<Callout type="warning">
`url.hash` is always empty during SSR — browsers never send the fragment to the server. On the client the hash is available as expected.
</Callout>

### `params`

Route parameters matched by the Bun router. Server-only.

```svelte
<!-- file: src/Post.svelte -->
<script>
  import { params } from 'mochi-framework';
</script>

<h1>{params.slug}</h1>
```

### `cookies`

Read and write cookies on both server and client through one API. See the [Cookies demo](/demos/cookies/) for a full example.

```svelte
<script>
  import { cookies, isBrowser } from 'mochi-framework';

  const theme = cookies.get('theme') ?? 'light';
</script>
```

### `locals`

Per-request data set by middleware. Server-only.

```ts
// file: src/middleware.ts
import type { Handle } from 'mochi-framework';

export const auth: Handle = async ({ event, resolve }) => {
  event.locals.user = await getUser(event.cookies);
  return resolve(event);
};
```

```svelte
<!-- file: src/Dashboard.svelte -->
<script>
  import { locals } from 'mochi-framework';

  const user = locals.user;
</script>
```

### `getRequestContext()`

Returns the full context object with all fields. Server-only. Prefer the individual exports above unless you need multiple fields at once.

```ts
import { getRequestContext } from 'mochi-framework';

const { url, params, cookies, locals, request, requestId } = getRequestContext();
```

`url` and `cookies` work on both server and client; `getRequestContext()`, `params`, and `locals` are server-only and throw in the browser, so guard those branches with `isServer`.

The context also carries `isWarmup` — `true` when the request was issued by [route warmup](/docs/serve-options/#route-warmup) at startup, not a real client. Guard side effects in `serverProps` that shouldn't fire for synthetic warmup hits:

```ts
serverProps: async () => {
  const ctx = getRequestContext();
  if (!ctx.isWarmup) await recordVisit(ctx.url.pathname); // skip warmup
  return { posts: await loadPosts() };
};
```
