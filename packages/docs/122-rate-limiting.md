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

| Option         | Default       |                                                                   |
| -------------- | ------------- | ----------------------------------------------------------------- |
| `limit`        | `100`         | Max requests per window                                           |
| `window`       | `'1m'`        | `'30s'`, `'1m'`, `'1h'`, `'1d'`, or milliseconds                  |
| `key`          | client IP     | `(req) => string` — what to bucket by                             |
| `store`        | in-memory     | `sqliteStore(…)`, `postgresStore(…)`, or a custom `HitLimitStore` |
| `tiers`/`tier` | —             | Named limits + per-request tier resolver                          |
| `ban`          | —             | `{ threshold, duration }` — ban repeat offenders                  |
| `group`        | —             | Shared quota across clients                                       |
| `skip`         | —             | `(req) => boolean` — bypass without consuming quota               |
| `response`     | hitlimit JSON | Custom 429 body (API routes)                                      |
| `headers`      | all on        | `{ standard, legacy, retryAfter }`                                |
| `onStoreError` | `'allow'`     | Fail open or `'deny'` when the store errors                       |

### Stores

Memory is the default — zero config, per-process. For persistence across restarts use SQLite; for shared state across instances use Postgres. Both are re-exported from `mochi-framework`:

```ts
import { sqliteStore, postgresStore } from 'mochi-framework';

rateLimit: { limit: 100, window: '1m', store: sqliteStore({ path: './ratelimit.db' }) }
rateLimit: { limit: 100, window: '1m', store: postgresStore({ url: process.env.DATABASE_URL }) }
```

Two routes given the **same store instance** share counters (same key, same bucket). Distinct configs otherwise get independent buckets even on the same db file path — keys are per-store-instance state in memory, but persisted stores share by key, so prefer a custom `key` if you need separation.

### Keys and proxies

The default key is Mochi's **proxy-aware** client address — the same value as [`getClientAddress()`](/docs/request-context/), honouring `proxy.addressHeader` / `xffDepth`. Behind a reverse proxy, configure `proxy` or every client shares the proxy's IP:

```ts
await Mochi.serve({ proxy: { addressHeader: 'x-forwarded-for', xffDepth: 1 }, … });
```

Key by anything else with `key`:

```ts
rateLimit: { limit: 1000, window: '1h', key: (req) => req.headers.get('x-api-key') ?? 'anon' }
```

### Reading usage server-side

An allowed request exposes its limiter state on the request context — render quotas in `serverProps` or any server-side code:

```ts
const rateLimit = getRequestContext().rateLimit;
// { limit: 5, remaining: 3, resetIn: 42, resetAt, key, tier? } — or undefined if no limiter ran
```

<Callout type="info">

**Not counted:** [warmup](/docs/serve-options/) requests, trailing-slash redirects, and CSRF rejections never consume quota. In dev, editing a route file resets that route's in-memory counters.

</Callout>

<SeeItInAction
demos={[
{ href: "/demos/rate-limit/", title: "Rate Limiting", hook: "5 requests per minute per IP — reload past the limit to hit the 429 error page." },
]}
/>
