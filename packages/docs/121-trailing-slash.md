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

The `trailingSlash` option on `Mochi.serve()` enforces a consistent trailing-slash policy across your `Mochi.page()` routes. Mochi registers each page under both `/foo` and `/foo/`, then redirects requests to the non-canonical form. `Mochi.api()`, `Mochi.sse()`, `Mochi.ws()` and `Mochi.file()` routes are exempt — see below.

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

### Only page routes follow the policy

<VersionNote since="0.10.0" message="Before 0.10.0, api and sse routes were mirrored and redirected like pages, ws and extensionless file routes answered on both slash forms without redirecting, and paths matching no route were redirected to the canonical form before 404ing." />

`trailingSlash` never applies to `Mochi.api()`, `Mochi.sse()`, `Mochi.ws()` or `Mochi.file()` routes — no mirroring, no redirect, regardless of policy. Only the exact pattern you declared matches; the other slash form 404s like any unregistered path.

```ts
await Mochi.serve({
  trailingSlash: 'always',
  routes: {
    '/about': Mochi.page(About), // /about → 301 → /about/
    '/api/ping': Mochi.api(() => json({ ok: true })), // only /api/ping matches
    '/sse/time': Mochi.sse(clock), // only /sse/time matches
    '/ws/chat': Mochi.ws(chat), // only /ws/chat matches
  },
});
```

A canonical URL is a navigation concern: it matters for links, crawlers and caches, which is what pages have and what a JSON fetch, an `EventSource` or a WebSocket does not.

A raw Bun route value (a bare `Response` or `{ GET }` object) isn't one of these helpers, so it still answers on both forms when a policy is set.

### Redirect status codes

| Method                                  | Status                 |
| --------------------------------------- | ---------------------- |
| `GET`, `HEAD`                           | 301 Moved Permanently  |
| All others (`POST`, `PUT`, `DELETE`, …) | 308 Permanent Redirect |

308 preserves the request method and body, so `<form method="POST" action="/submit">` still works after a redirect. This needs the page to accept POST at all: a page without `actions` registers only GET/HEAD, so a POST to it matches no route and is never redirected.

### Paths that are never redirected

- The root path `/` — already canonical.
- Paths with file extensions (`.css`, `.js`, `.png`, …) — browsers and CDNs expect exact asset URLs.
- Anything that isn't a `Mochi.page()` route.
- Paths that match no route — they 404 (or reach your `fetch` fallback) in whichever slash form they arrived, with no canonicalization hop.

### Query strings

Mochi preserves query parameters in the redirect target:

```
GET /search/?q=mochi  →  301  Location: /search?q=mochi   (policy: 'never')
GET /search?q=mochi   →  301  Location: /search/?q=mochi  (policy: 'always')
```

### Generating canonical links

`trailingSlashIt(path)` appends a trailing slash, first stripping any the string already ends with. It preserves a query string or `#fragment` and puts the slash on the path, so you can pass a full URL. Build hrefs with it under `trailingSlash: 'always'` so links point at the canonical URL and skip the redirect hop.

Apply it to page URLs only. Every other kind has no slashed form, so `trailingSlashIt('/api/ping')` yields a URL that 404s.

```ts
import { trailingSlashIt } from 'mochi-framework';

trailingSlashIt('/docs/intro'); // '/docs/intro/'
trailingSlashIt('/docs/intro/'); // '/docs/intro/'
trailingSlashIt('/'); // '/'
trailingSlashIt('/search?q=mochi'); // '/search/?q=mochi'
trailingSlashIt('/docs/intro#install'); // '/docs/intro/#install'
```

It is isomorphic — import it in SSR pages, hydrated islands, and plain `.ts` modules.
