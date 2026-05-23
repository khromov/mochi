---
title: 'Trailing slash'
slug: trailing-slash
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
