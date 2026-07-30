---
title: 'Rate limiting'
slug: rate-limiting
description: 'Per-route and global request rate limiting with memory, SQLite, and Postgres stores.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Rate limiting

Add a `rateLimit` config to any `Mochi.page()` or `Mochi.api()` route. It is driven by [`@joint-ops/hitlimit-bun`](https://www.npmjs.com/package/@joint-ops/hitlimit-bun), and the options pass straight through.

```ts
'/api/data': Mochi.api(handler, {
  rateLimit: { limit: 100, window: '1m' },
}),
'/pricing': Mochi.page('./src/Pricing.svelte', {
  rateLimit: { limit: 5, window: '1m' },
}),
```

Mochi keys requests by client IP by default. Over the limit:

- **API routes** return a `429` JSON body (`{ hitlimit: true, message, limit, remaining, resetIn }`).
- **Page routes** render your [error page](/docs/error-handling/) with status `429`. Enhanced form submissions get JSON, like other form errors.

A blocked request never reaches your [`handle` middleware](/docs/middleware/) — the `429` is produced before it runs, like a CSRF rejection — but it still emits the standard `request` event, so it appears in [logging](/docs/logging/).

Every limited route's responses carry `RateLimit-*` and `X-RateLimit-*` headers, plus `Retry-After` on a `429`.

### Global default

Set `rateLimit` on `Mochi.serve()` to cover every page and API route. Routes inheriting it share **one bucket per key** — a client's hits on any of them count against the same quota. A route's own config replaces the global one with its own bucket. `rateLimit: false` opts a route out.

```ts
await Mochi.serve({
  routes: {
    '/api/login': Mochi.api(login, { rateLimit: { limit: 5, window: '1m' } }), // own bucket
    '/health': Mochi.api(health, { rateLimit: false }), // exempt
  },
  rateLimit: { limit: 1000, window: '1m' }, // everything else
});
```

### Options

Mochi accepts all of hitlimit's options except `logger` (Mochi logs `429`s through its own [request events](/docs/events/)):

| Option         | Default       |                                                                                 |
| -------------- | ------------- | ------------------------------------------------------------------------------- |
| `limit`        | `100`         | Max requests per window                                                         |
| `window`       | `'1m'`        | `'30s'`, `'1m'`, `'1h'`, `'1d'`, or milliseconds                                |
| `key`          | client IP     | `(req, ctx) => string` — what to bucket by                                      |
| `store`        | in-memory     | `sqliteStore(…)`, `postgresStore(…)`, or a custom `MochiRateLimitStore`         |
| `tiers`/`tier` | —             | Named limits + `(req, ctx) => string` tier resolver                             |
| `ban`          | —             | `{ threshold, duration }` — ban repeat offenders                                |
| `group`        | route pattern | `string \| (req, ctx) => string` — bucket namespace; same value → shared bucket |
| `skip`         | —             | `(req, ctx) => boolean` — bypass without consuming quota                        |
| `response`     | hitlimit JSON | Custom 429 body (API routes)                                                    |
| `headers`      | all on        | `{ standard, legacy, retryAfter }`                                              |
| `onStoreError` | `'allow'`     | Fail open, or `'deny'` when the store errors                                    |

### Stores

Memory is the default — zero config, per process. Use SQLite for persistence across restarts, or Postgres for shared state across instances. Both are re-exported from `mochi-framework`:

```ts
import { sqliteStore, postgresStore } from 'mochi-framework';

rateLimit: { limit: 100, window: '1m', store: sqliteStore({ path: './ratelimit.db' }) }
rateLimit: { limit: 100, window: '1m', store: postgresStore({ url: process.env.DATABASE_URL }) }
```

Mochi buckets counters by **key within a store**. A route with its own `rateLimit` config also folds its route pattern into the key, so different routes backed by the same database keep separate counters, even when the key resolves to the same value. Run the same route on two servers against one database and both write the same key, so they share a counter — that is how you rate-limit across a fleet. Routes inheriting the [global default](#global-default) share one bucket per key by design.

<Callout type="info">

**Overriding the namespace with `group`.** Setting `group` replaces the automatic route-pattern namespace. Give two routes the same `group` and they share one bucket — a single quota across a family of endpoints. Give a route on the global default its own `rateLimit` config to split it into an isolated bucket.

</Callout>

Each store instance owns its backend — a DB connection, prepared statements, and a cleanup timer. Create the store **once** and share the instance. Calling `sqliteStore({ path })` inline in every route config opens one connection per route to the same file, all fighting over SQLite's single write lock.

```ts
const store = sqliteStore({ path: './ratelimit.db' }); // one connection…
'/api/search': Mochi.api(search, { rateLimit: { limit: 30, window: '1m', store } }), // …own bucket
'/api/upload': Mochi.api(upload, { rateLimit: { limit: 5, window: '1m', store } }), // …own bucket
```

<Callout type="info">

**Dev reloads.** Creating a store inline in a route config builds a fresh store on every save while the old one is never closed, leaking a handle per reload. Counters still persist. If the churn bothers you, keep dev on the default memory store and attach the persisted store in production only.

</Callout>

### Keys and proxies

The default key is Mochi's **proxy-aware** client address — the same value as [`getClientAddress()`](/docs/request-context/), honouring `proxy.addressHeader` / `xffDepth`. Behind a reverse proxy, configure `proxy` or every client shares the proxy's IP:

```ts
await Mochi.serve({ proxy: { addressHeader: 'x-forwarded-for', xffDepth: 1 }, … });
```

Key by anything else with `key`. It receives the `Request` plus Mochi's [request context](/docs/request-context/), so you can bucket by the proxy-aware IP, cookies, params, or your own identity. It can be `async`. `tier`, `group`, and `skip` receive the same two arguments.

```ts
// by API key, falling back to the proxy-aware IP
key: (req, ctx) => req.headers.get('x-api-key') ?? ctx.getClientAddress() ?? 'anon'

// tiered by plan
tiers: { free: { limit: 10 }, pro: { limit: 1000 } },
tier: (req, ctx) => (ctx.locals.plan as string) ?? 'free',
```

<Callout type="warning">

**The limiter runs before your `handle` [middleware](/docs/middleware/).** `ctx` is fully populated — `request`, `url`, `params`, `cookies`, `getClientAddress()` — but `ctx.locals` reflects only what ran before the limiter. A `userId` your auth middleware puts on `locals` is **not** visible here. To key by the logged-in user, derive the identity straight from the request inside `key` (decode the session cookie or bearer token).

</Callout>

### Only counting failures

`skip` bypasses the limiter without consuming quota. Since the limiter runs before your middleware, re-do the credential check inside `skip` so only rejected attempts spend quota. A brute-force run burns the quota. Someone who knows the password is never throttled.

```ts
'/admin': Mochi.page('./src/Admin.svelte', {
  rateLimit: {
    limit: 10,
    window: '15m',
    ban: { threshold: 3, duration: '1h' },
    skip: (req) => credentialsMatch(req.headers.get('Authorization')),
  },
}),
```

`skip` may be `async`, so it is also a natural place for a tarpit. An `await Bun.sleep(…)` on the failing branch delays the rejection without slowing a valid request:

```ts
skip: async (req) => {
  const header = req.headers.get('Authorization');
  if (!header || credentialsMatch(header)) return true;
  await Bun.sleep(5000);
  return false;
},
```

### Reading usage server-side

An allowed request exposes its limiter state on the request context. Render quotas in `serverProps` or any server-side code:

```ts
const rateLimit = getRequestContext().rateLimit;
// { limit, remaining, resetIn, resetAt, key, group?, tier? } — or undefined if no limiter ran
```

<Callout type="info">

**Not counted:** [warmup](/docs/serve-options/) requests, trailing-slash redirects, and CSRF rejections never consume quota. In dev, `rateLimit` edits apply on save — a route with its own config gets fresh in-memory counters; routes on the global limiter keep their shared bucket.

</Callout>

<SeeItInAction
demos={[
{ href: "/demos/rate-limit/", title: "Rate Limiting", hook: "How rate limiting works — a rateLimit config on the route caps requests per IP per minute and serves the 429 error page past the limit." },
]}
/>
