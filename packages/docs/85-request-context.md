---
title: 'Request context'
slug: request-context
description: 'Access the current URL, route params, cookies, and locals from server-side code, plus the isomorphic url export.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Request context

Inside components and server-side helpers, import context values directly from `mochi-framework`:

```ts
import { url, params, cookies, locals } from 'mochi-framework';
```

Each export reads from the current request's context on every property access, so you never thread values through props.

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

`url` is **isomorphic**. On the server it reads the parsed request URL. On the client it reflects the current browser URL, including after `pushState` / `replaceState`.

<Callout type="info">

`url` reflects the live browser URL on each access, so a destructured value like `const { pathname } = url` is a snapshot. Access `url.pathname` directly when you need the live value.

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

<VersionNote since="0.10.0" message="Before 0.10.0, cookies.set() and cookies.delete() in the browser wrote nothing when passed httpOnly: true." />

Read and write cookies on the server and the client through one API. In the browser, `cookies.set()` and `cookies.delete()` ignore `httpOnly`, because a browser discards any `document.cookie` write that carries it. See the [Cookies demo](/demos/cookies/).

```svelte
<script>
  import { cookies } from 'mochi-framework';

  const theme = cookies.get('theme') ?? 'light';
</script>
```

Delete a cookie with the same per-call options you set it with. See [`cookie:defaults`](/docs/extensions/#cookiedefaults).

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

### `getCspNonce()`

<VersionNote since="0.10.0" message="getCspNonce() ships in the next Mochi release (0.10.0)." />

Returns the current request's CSP nonce, or `undefined` when the [`csp` serve option](/docs/serve-options/#content-security-policy-nonce) is off. Use it to build the `Content-Security-Policy` header in middleware, or to stamp a script of your own:

```svelte
<!-- file: src/Analytics.svelte -->
<script>
  import { getCspNonce } from 'mochi-framework';

  const nonce = getCspNonce();
</script>

<svelte:head>
  <script {nonce} src="/analytics.js"></script>
</svelte:head>
```

It also works in middleware for the fall-through 404, which has no full request context. In the browser it returns `undefined`.

<SeeItInAction
demos={[
{ href: "/demos/request-id/", title: "Request ID", hook: "How request IDs work — every request gets a UUID v7 on getRequestContext().requestId that rides every lifecycle event for correlation." },
{ href: "/demos/cookies/", title: "Cookies", hook: "How cookies work — read and write on the server and the client through one MochiCookieJar API (cookies.get/set/delete)." },
]}
/>
