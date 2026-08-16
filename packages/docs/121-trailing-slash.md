---
title: 'Trailing slash'
slug: trailing-slash
ogTitle: 'Trailing-slash policy and redirects'
description: 'Enforce a consistent trailing-slash policy for your page routes with automatic redirects.'
---

<script>
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Trailing slash

The `trailingSlash` option on `Mochi.serve()` enforces a consistent trailing-slash policy across `Mochi.page()` and `Mochi.sse()` routes. Mochi registers each route under both `/foo` and `/foo/`, then redirects requests to the non-canonical form. `Mochi.api()` routes are always exempt — see below. `Mochi.file()` and `Mochi.ws()` routes are registered under both forms but never redirect, so either form serves them.

```ts
await Mochi.serve({
  trailingSlash: 'always',
  routes,
});
```

### Policy values

| Value      | Canonical form | Example redirect     |
| ---------- | -------------- | -------------------- |
| `'never'`  | No slash       | `/about/` → `/about` |
| `'always'` | Trailing slash | `/about` → `/about/` |

Default: unset. Neither form is redirected, and only the form you registered is matched.

### `Mochi.api()` routes are exempt

<VersionNote since="0.10.0" message="Before 0.10.0, api routes followed the trailingSlash policy like page routes — both slash forms were registered and the non-canonical one redirected." />

`trailingSlash` never applies to `Mochi.api()` routes — no mirroring, no redirect, regardless of policy. Only the exact pattern you declared matches; the other slash form 404s like any unregistered path.

```ts
await Mochi.serve({
  trailingSlash: 'always',
  routes: {
    '/about': Mochi.page(About), // /about → 301 → /about/
    '/api/ping': Mochi.api(() => json({ ok: true })), // only /api/ping matches
  },
});
```

To answer on both forms — an endpoint whose URL is already published, say — point both patterns at one route:

```ts
const ping = Mochi.api(() => json({ ok: true }));

await Mochi.serve({
  trailingSlash: 'always',
  routes: { '/api/ping': ping, '/api/ping/': ping },
});
```

### Redirect status codes

| Method                                  | Status                 |
| --------------------------------------- | ---------------------- |
| `GET`, `HEAD`                           | 301 Moved Permanently  |
| All others (`POST`, `PUT`, `DELETE`, …) | 308 Permanent Redirect |

308 preserves the request method and body, so `<form method="POST" action="/submit">` still works after a redirect.

### Paths that are never redirected

- The root path `/` — already canonical.
- Paths with file extensions (`.css`, `.js`, `.png`, …) — browsers and CDNs expect exact asset URLs.

### Query strings

Mochi preserves query parameters in the redirect target:

```
GET /search/?q=mochi  →  301  Location: /search?q=mochi   (policy: 'never')
GET /search?q=mochi   →  301  Location: /search/?q=mochi  (policy: 'always')
```

### Generating canonical links

`trailingSlashIt(path)` appends a trailing slash, first stripping any the string already ends with. It preserves a query string or `#fragment` and puts the slash on the path, so you can pass a full URL. Build hrefs with it under `trailingSlash: 'always'` so links point at the canonical URL and skip the redirect hop.

```ts
import { trailingSlashIt } from 'mochi-framework';

trailingSlashIt('/docs/intro'); // '/docs/intro/'
trailingSlashIt('/docs/intro/'); // '/docs/intro/'
trailingSlashIt('/'); // '/'
trailingSlashIt('/search?q=mochi'); // '/search/?q=mochi'
trailingSlashIt('/docs/intro#install'); // '/docs/intro/#install'
```

It is isomorphic — import it in SSR pages, hydrated islands, and plain `.ts` modules.
