---
title: 'Mochi.fetch'
slug: fetch
description: 'A resilient fetch wrapper with retries, a request timeout, and an optional base URL — otherwise the standard fetch/Response API.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Mochi.fetch

<Callout type="warning">

**Experimental.** This API is new and may change in a future release.

</Callout>

`Mochi.fetch()` wraps the native `fetch` with retries, a per-attempt timeout, and an optional base URL. It returns a **standard `Response`** — there's no bespoke response object to learn, and non-retried calls pass straight through:

```ts
import { Mochi } from 'mochi-framework';

const res = await Mochi.fetch('/users', {
  baseUrl: 'https://api.example.com',
  retries: 3,
  timeout: 5_000,
});
const users = await res.json();
```

It's isomorphic. Inside a `.svelte` island, import the same helper as `mochiFetch`:

```svelte
<script>
  import { mochiFetch } from 'mochi-framework';

  async function load() {
    const res = await mochiFetch('https://api.example.com/ping', { retries: 2 });
    return res.ok;
  }
</script>
```

## Options

Every standard `RequestInit` field (`method`, `headers`, `body`, `signal`, …) is accepted, plus:

| Option             | Default                                   | Description                                                       |
| ------------------ | ----------------------------------------- | ----------------------------------------------------------------- |
| `baseUrl`          | —                                         | Prefixes a relative `input`. Absolute inputs ignore it.           |
| `timeout`          | `10_000`                                  | Per-attempt timeout in ms. Each retry gets a fresh timeout.       |
| `retries`          | `2`                                       | Additional attempts after the first (so `2` → up to 3 total).     |
| `retryDelay`       | `300`                                     | Base backoff in ms; grows exponentially with full jitter, capped. |
| `retryStatusCodes` | `[408, 429, 500, 502, 503, 504]`          | Response statuses that trigger a retry.                           |
| `retryMethods`     | `['GET','HEAD','PUT','DELETE','OPTIONS']` | Methods eligible for retry (case-insensitive).                    |

Retries fire on a thrown network error or a retryable status. When the upstream sends a `Retry-After` header (e.g. on `429`/`503`), it's honored in place of the computed backoff.

```ts
// Opt a POST into retries and cap the wait:
await Mochi.fetch('/jobs', {
  method: 'POST',
  body: JSON.stringify(job),
  headers: { 'content-type': 'application/json' },
  retryMethods: ['POST'],
  retries: 4,
});
```

<Callout type="info">

**`timeout` is per attempt, not total.** With `retries: 2` and `timeout: 5_000`, a fully-failing request can take up to ~15s of upstream time plus backoff. **Only idempotent methods retry by default** — `POST`/`PATCH` are excluded so a write that the server may have already processed isn't duplicated; opt them in with `retryMethods`. A caller-supplied `signal` that aborts is surfaced immediately and never retried.

</Callout>
