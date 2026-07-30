---
title: 'Request context'
slug: request-context
description: 'Access the current URL, route params, cookies, and locals from server-side code, plus the isomorphic url export.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Request context

Inside components and server-side helpers, import context values directly from `mochi-framework`:

```ts
import { url, params, cookies, locals } from 'mochi-framework';
```

Each export is a proxy that reads from the current request's `AsyncLocalStorage` context on every property access, so you never thread values through props.

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

`url` is **isomorphic**. On the server it proxies `getRequestContext().url`. On the client it proxies `new URL(window.location.href)`, constructed fresh on each access, so it always reflects the current browser URL, including after `pushState` / `replaceState`.

<Callout type="info">
The proxy constructs a fresh URL on every access, so a destructured value like <code>const {'{'} pathname {'}'} = url</code> is a snapshot. Access <code>url.pathname</code> directly when you need the live value.
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

Read and write cookies on the server and the client through one API. See the [Cookies demo](/demos/cookies/).

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

Returns the full context object with all fields. Server-only. Prefer the individual exports above unless you need several fields at once.

```ts
import { getRequestContext } from 'mochi-framework';

const { url, params, cookies, locals, request, requestId } = getRequestContext();
```

`url` and `cookies` work on the server and the client. `getRequestContext()`, `params`, and `locals` are server-only and throw in the browser, so guard those branches with `isServer`.

The context also carries `isWarmup` — `true` when the request came from [route warmup](/docs/serve-options/#route-warmup) at startup, not a real client. Guard side effects in `serverProps` that should not fire for synthetic warmup hits:

```ts
serverProps: async () => {
  const ctx = getRequestContext();
  if (!ctx.isWarmup) await recordVisit(ctx.url.pathname); // skip warmup
  return { posts: await loadPosts() };
};
```

<SeeItInAction
demos={[
{ href: "/demos/request-id/", title: "Request ID", hook: "Every request gets a UUID v7 on getRequestContext().requestId." },
{ href: "/demos/cookies/", title: "Cookies", hook: "Read and write on server and client through one MochiCookieJar API." },
]}
/>
