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

The request cache memoizes work for the duration of one HTTP request. Entries die with the request, so a page that renders the same lookup in ten components pays for it once, and the next request always sees fresh data.

```ts
import { requestCache } from 'mochi-framework';

const user = await requestCache(`user:${id}`, () => db.user(id));
```

Every value the callback reads must appear in the key — the cache never inspects the function, so a key that omits `id` collides silently.

### requestMemo

Wrap a function once at module scope and every call site is memoized by its arguments:

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

The wrapper _is_ the shared identity: two separate `requestMemo()` calls over the same function get separate entries. Export the wrapped function so every importer shares it, or pass `{ namespace }` to deliberately share entries between wrappers.

Arguments are keyed by a type-tagged serialization (`1` and `'1'` never collide; objects go through `JSON.stringify`). For arguments that can't be serialized — functions, class instances, cyclic objects — pass your own `key`:

```ts
const getProfile = requestMemo((user: User) => db.profile(user.id), { key: (user) => user.id });
```

### Async

Both forms store the in-flight promise on the first call, so concurrent callers share one execution rather than racing:

```ts
// One fetch, three awaits.
const [a, b, c] = await Promise.all([getUser('42'), getUser('42'), getUser('42')]);
```

A rejected promise evicts its entry, so a failure is never cached — the next call retries.

### The store

`getRequestCache()` returns the underlying store when you need imperative access:

```ts
import { getRequestCache } from 'mochi-framework';

const cache = getRequestCache();
cache.set('tenant', tenant);
cache.get('tenant');
cache.delete('tenant');
cache.stats(); // { hits, misses } — also shown in the debug bar's Cache panel
```

### Outside a request

Called outside a request handler — a startup script, a background job, a detached email render — the callback simply runs uncached, with a one-time warning in development. Nothing throws, so helpers built on the request cache stay usable everywhere.

For a `requestMemo` wrapper that is _expected_ to run outside a request — a background warm, a detached render, work reachable from a non-request endpoint — pass `{ quiet: true }` to suppress that warning, since falling through uncached there is intended rather than a mistake:

```ts
export const getUser = requestMemo((id: string) => db.user(id), { quiet: true });
```

### On the client

These are server-only helpers — they memoize against the request context, which only exists on the server. When an island's `<script>` runs again during hydration, the browser bundle resolves them to no-op stubs instead of throwing: `requestCache(key, fn)` just runs `fn()` uncached, `requestMemo(fn)` returns `fn` unwrapped, and `getRequestCache()` hands back a fresh throwaway store per call. Nothing is shared or retained between hydrations, so there is no client-side cache to grow.

<Callout type="warning">

The client stub re-runs the callback — it does **not** replay the server's cached value. A top-level island read like `requestCache(key, () => db.user(id))` runs on the server during SSR and _again_ on the client during hydration, where `db` isn't available. The request cache dedups server work within one render; it is not a way to ship a value to the browser. To reuse an SSR-computed value client-side, wrap it in Svelte's [`hydratable(key, fn)`](/docs/hydratable/).

</Callout>

<Callout type="warning">

**Not a replacement for `MochiCache`.** The request cache has no TTL, no storage backend, and no eviction — the request boundary is the TTL. Use [`MochiCache`](/docs/cache/) for anything that should survive a request; use the request cache to stop repeating work _within_ one.

</Callout>

### In the debug bar

In development, the debug bar's **Cache** panel has a **Request cache** section reporting the hits, misses, hit rate, and surviving entries for the render that produced the page.

<SeeItInAction
demos={[
{ href: "/demos/request-cache/", title: "Request Cache", hook: "Nine MochiCoin ledger rows over three blocks — the memoized pass mines three proof-of-work hashes instead of nine." },
]}
/>
