---
title: 'Request cache'
slug: request-cache
description: 'Memoize server-side work for the duration of a single request with requestCache and requestMemo.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Request cache

The request cache memoizes work for the duration of one HTTP request. Entries die with the request, so a page that renders the same lookup in ten components pays for it once, and the next request sees fresh data.

```ts
import { requestCache } from 'mochi-framework';

const user = await requestCache(`user:${id}`, () => db.user(id));
```

Every value the callback reads must appear in the key. The cache never inspects the function, so a key that omits `id` collides silently.

### requestMemo

Wrap a function once at module scope. Every call site is then memoized by its arguments:

```ts
import { requestMemo } from 'mochi-framework';

export const getUser = requestMemo((id: string) => db.user(id));
```

```svelte
<script>
  import { getUser } from '../lib/users';

  // However many components call this, one query per request.
  const user = await getUser(params.id);
</script>
```

The wrapper is the shared identity. Two separate `requestMemo()` calls over the same function get separate entries. Export the wrapped function so every importer shares it, or pass `{ namespace }` to share entries between wrappers.

Arguments are keyed by a type-tagged serialization (`1` and `'1'` never collide; objects go through `JSON.stringify`). For arguments that cannot serialize, pass your own `key`:

```ts
const getProfile = requestMemo((user: User) => db.profile(user.id), { key: (user) => user.id });
```

### Async

Both forms store the in-flight promise on the first call, so concurrent callers share one execution:

```ts
// One fetch, three awaits.
const [a, b, c] = await Promise.all([getUser('42'), getUser('42'), getUser('42')]);
```

A rejected promise evicts its entry, so a failure is never cached. The next call retries.

### The store

`getRequestCache()` returns the underlying store for imperative access:

```ts
import { getRequestCache } from 'mochi-framework';

const cache = getRequestCache();
cache.set('tenant', tenant);
cache.get('tenant');
cache.delete('tenant');
cache.stats(); // { hits, misses } — also shown in the debug bar's Cache panel
```

### Outside a request

Called outside a request handler — a startup script, a background job, a detached email render — the callback runs uncached, with a one-time warning in development. Nothing throws, so helpers built on the request cache stay usable everywhere.

For a `requestMemo` wrapper expected to run outside a request, pass `{ quiet: true }` to suppress that warning:

```ts
export const getUser = requestMemo((id: string) => db.user(id), { quiet: true });
```

### On the client

These are server-only helpers. In the browser bundle they resolve to no-op stubs instead of throwing: `requestCache(key, fn)` runs `fn()` uncached, `requestMemo(fn)` returns `fn` unwrapped, and `getRequestCache()` hands back a fresh throwaway store per call.

<Callout type="warning">

**The request cache is a server-side convenience API.** Inside a hydrated component the calls run without the server's cached values — `requestCache(key, () => db.user(id))` runs on the server during SSR and again on the client during hydration, where `db` might not exist. To reuse a server-computed value on hydration, wrap it in Svelte's [`hydratable(key, fn)`](/docs/hydratable/) instead, or pass it as `serverProps`.

</Callout>

<Callout type="warning">

**Not a replacement for `MochiCache`.** The request cache has no TTL, no storage backend, and no eviction — the request boundary is the TTL. Use [`MochiCache`](/docs/cache/) for anything that should survive a request. Use the request cache to stop repeating work within one.

</Callout>

### In the debug bar

In development, the debug bar's **Cache** panel has a **Request cache** section reporting hits, misses, hit rate, and surviving entries for the render that produced the page.

<SeeItInAction
demos={[
{ href: "/demos/request-cache/", title: "Request Cache", hook: "Run an expensive computation once per request no matter how many components call it." },
]}
/>
