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

Add a `rateLimit` config to any `Mochi.page()` or `Mochi.api()` route. It's a thin shim around [`@joint-ops/hitlimit-bun`](https://www.npmjs.com/package/@joint-ops/hitlimit-bun) — the options pass straight through.

```ts
'/api/data': Mochi.api(handler, {
  rateLimit: { limit: 100, window: '1m' },
}),
'/pricing': Mochi.page('./src/Pricing.svelte', {
  rateLimit: { limit: 5, window: '1m' },
}),
```

Requests are keyed by client IP by default. Over the limit:

- **API routes** return a `429` JSON body (`{ hitlimit: true, message, limit, remaining, resetIn }`).
- **Page routes** render your configured [error page](/docs/error-handling/) with status `429`. Enhanced form submissions get JSON instead, like other form errors.

Blocked requests never reach your [`handle` middleware](/docs/middleware/) — the `429` is produced before it runs, like CSRF rejections — but they still emit the standard `request` event, so they show up in [logging](/docs/logging/).

Every limited route's responses — allowed or blocked — carry `RateLimit-*` and `X-RateLimit-*` headers, plus `Retry-After` on a `429`.

```sh
curl -i http://localhost:3333/api/data
# RateLimit-Limit: 100
# RateLimit-Remaining: 99
```

### Global default

Set `rateLimit` on `Mochi.serve()` to cover every page and API route. Routes inheriting it share **one bucket per key** — a client's hits on any of them count against the same quota. A route's own config replaces the global one with its own bucket; `rateLimit: false` opts a route out.

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

All of hitlimit's options are accepted (except `logger` — Mochi logs `429`s through its own [request events](/docs/events/)):

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
| `onStoreError` | `'allow'`     | Fail open or `'deny'` when the store errors                                     |

### Stores

Memory is the default — zero config, per-process. For persistence across restarts use SQLite; for shared state across instances use Postgres. Both are re-exported from `mochi-framework`:

```ts
import { sqliteStore, postgresStore } from 'mochi-framework';

rateLimit: { limit: 100, window: '1m', store: sqliteStore({ path: './ratelimit.db' }) }
rateLimit: { limit: 100, window: '1m', store: postgresStore({ url: process.env.DATABASE_URL }) }
```

Counters are bucketed by **key within a store**. A route with its **own** `rateLimit` config also folds its route pattern into that key, so **different routes** backed by the same database — whether they share one store object or each open their own connection to it — keep **separate** counters, even when the key resolves to the same value (e.g. the same client IP). This is per-route _pattern_, not per-instance: run the same route on two servers against one database and both write the same key, so they share a counter — that's how you rate-limit across a fleet. Routes inheriting the [global default](#global-default) are _not_ pattern-namespaced: they all share one bucket per key, by design.

<Callout type="info">

**Overriding the namespace with `group`.** Setting `group` replaces the automatic route-pattern namespace with your own. Give two routes the **same** `group` and they share one bucket — a single quota across a family of endpoints (e.g. `/api/auth/login` and `/api/auth/reset`), on any store. Going the other way: routes on the [global default](#global-default) all share one bucket, so give a route its **own** `rateLimit` config to split it off into an isolated one.

</Callout>

Each store instance owns its backend — a DB connection, prepared statements, and a cleanup timer (or, for memory, a Map and a sweep timer). So don't call `sqliteStore({ path })` inline in every route config: that opens one connection **per route** to the same file, each with its own cleanup sweep, all fighting over SQLite's single write lock (every hit is a write). To cover many routes against one database, create the store **once** and share the instance — the same object folds each route's pattern into its keys, so you get one connection with **separate** per-route counters:

```ts
const store = sqliteStore({ path: './ratelimit.db' }); // one connection…
'/api/search': Mochi.api(search, { rateLimit: { limit: 30, window: '1m', store } }), // …own bucket
'/api/upload': Mochi.api(upload, { rateLimit: { limit: 5, window: '1m', store } }), // …own bucket
```

Or hang it off the [global default](#global-default) (`Mochi.serve({ rateLimit: { store } })`) — also one connection, but then every inheriting route shares **one bucket per key**.

<Callout type="info">

**Dev reloads.** Creating a store inline in a route config makes each save of that file build a fresh store while the old one — being user-supplied — is never closed by the framework, leaking a handle per reload. Counters still persist (they live in the db), but if the churn bothers you, keep dev on the default memory store and attach the persisted store in production only.

</Callout>

### Keys and proxies

The default key is Mochi's **proxy-aware** client address — the same value as [`getClientAddress()`](/docs/request-context/), honouring `proxy.addressHeader` / `xffDepth`. Behind a reverse proxy, configure `proxy` or every client shares the proxy's IP:

```ts
await Mochi.serve({ proxy: { addressHeader: 'x-forwarded-for', xffDepth: 1 }, … });
```

Key by anything else with `key`. It receives the `Request` plus Mochi's [request context](/docs/request-context/) — the same object [`getRequestContext()`](/docs/request-context/) returns, so you can bucket by the proxy-aware IP, cookies, params, or your own identity. It can be `async`. `tier`, `group`, and `skip` receive the same two arguments.

```ts
// by API key (falling back to the proxy-aware IP)
key: (req, ctx) => req.headers.get('x-api-key') ?? ctx.getClientAddress() ?? 'anon'

// by logged-in user — derive identity from the request (see the note below)
key: (req, ctx) => sessionUserId(ctx.cookies) ?? ctx.getClientAddress() ?? 'anon'

// by country, from a CDN geo header
key: (req) => req.headers.get('cf-ipcountry') ?? 'unknown'

// tiered by plan
tiers: { free: { limit: 10 }, pro: { limit: 1000 } },
tier: (req, ctx) => (ctx.locals.plan as string) ?? 'free',
```

<Callout type="warning">

**The limiter runs before your `handle` [middleware](/docs/middleware/).** `ctx` is fully populated — `request`, `url`, `params`, `cookies`, `getClientAddress()` — but `ctx.locals` only reflects what ran _before_ the limiter, and `handle` runs _after_ it. So a `userId` your auth middleware puts on `locals` is **not** visible here. To key by the logged-in user, derive the identity straight from the request inside `key` (decode the session cookie / bearer token), rather than reading a middleware-set local.

</Callout>

### Only counting failures

`skip` bypasses the limiter **without consuming quota**, which inverts nicely for auth: since the limiter runs before your middleware, re-do the credential check inside `skip` so only _rejected_ attempts spend quota. A brute-force run burns the quota; someone who knows the password is never throttled — even mid-ban.

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

`skip` may be `async`, which makes it the natural place for a tarpit too — it runs before anything else on the route, so an `await Bun.sleep(…)` on the failing branch delays the rejection (and the `429` once the quota is gone) without slowing a valid request:

```ts
skip: async (req) => {
  if (credentialsMatch(req.headers.get('Authorization'))) return true;
  await Bun.sleep(5000);
  return false;
},
```

### Reading usage server-side

An allowed request exposes its limiter state on the request context — render quotas in `serverProps` or any server-side code:

```ts
const rateLimit = getRequestContext().rateLimit;
// { limit: 5, remaining: 3, resetIn: 42, resetAt, key, group?, tier? } — or undefined if no limiter ran
```

<Callout type="info">

**Not counted:** [warmup](/docs/serve-options/) requests, trailing-slash redirects, and CSRF rejections never consume quota. In dev, `rateLimit` edits apply on save — editing a route file rebuilds that route's limiter, so a route with its own config gets fresh in-memory counters (routes on the global limiter keep their shared bucket).

</Callout>

<SeeItInAction
demos={[
{ href: "/demos/rate-limit/", title: "Rate Limiting", hook: "5 requests per minute per IP — reload past the limit to hit the 429 error page." },
]}
/>
