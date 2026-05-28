---
title: 'Trailing slash'
slug: trailing-slash
description: 'Enforce a consistent trailing-slash policy across all routes with automatic redirects.'
---

## Trailing slash

The `trailingSlash` option on `Mochi.serve()` enforces a consistent trailing-slash policy across every user route. The framework registers each route under both `/foo` and `/foo/`, then redirects requests to the non-canonical form.

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

Default: unset — neither form is redirected and only the form you registered is matched.

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

Query parameters are preserved in the redirect target:

```
GET /search/?q=mochi  →  301  Location: /search?q=mochi   (policy: 'never')
GET /search?q=mochi   →  301  Location: /search/?q=mochi  (policy: 'always')
```

### Generating canonical links

`trailingSlashIt(path)` appends a trailing slash, first stripping any the string already ends with so you never double-slash. Build hrefs with it under `trailingSlash: 'always'` so links point straight at the canonical URL and skip the redirect hop.

```ts
import { trailingSlashIt } from 'mochi-framework';

trailingSlashIt('/docs/intro'); // '/docs/intro/'
trailingSlashIt('/docs/intro/'); // '/docs/intro/'
trailingSlashIt('/'); // '/'
```

It is isomorphic — import it in SSR pages, hydrated islands, and plain `.ts` modules alike.

Do **NOT** pass a URL that carries a query string or `#fragment` — the slash lands at the very end, after the fragment. Instead, slash the path segment alone and re-attach the rest:

```ts
const [path, hash] = slug.split('#');
const href = hash ? `${trailingSlashIt(path)}#${hash}` : trailingSlashIt(path);
```
