---
title: 'Security'
slug: security
description: 'The protections Mochi turns on by default, starting with baseline security response headers, and how to change them.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Security

Mochi turns on a few protections by default. This page lists what each one does and how to change it.

### Security response headers

<VersionNote since="0.10.0" message="The securityHeaders option and the security:headers filter are new in 0.10.0." />

Every response the framework produces carries these headers by default: pages and form actions, `Mochi.api`, `Mochi.sse`, `Mochi.file`, the server-island endpoint, `publicDir` and `staticDirs` files, framework assets, the fall-through `404` and the CSRF `403`.

| Header                   | Value                             |
| ------------------------ | --------------------------------- |
| `X-Content-Type-Options` | `nosniff`                         |
| `Referrer-Policy`        | `strict-origin-when-cross-origin` |

Change them with the `securityHeaders` option, or add your own through the `security:headers` filter:

```ts
// file: src/index.ts
await Mochi.serve({
  securityHeaders: { frameOptions: 'SAMEORIGIN' }, // or `false` to drop every default
  filters: {
    'security:headers': (headers) => ({
      ...headers,
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    }),
  },
  routes,
});
```

| Option               | Default                             | Sends                                                        |
| -------------------- | ----------------------------------- | ------------------------------------------------------------ |
| `contentTypeOptions` | `true`                              | `X-Content-Type-Options: nosniff`                            |
| `referrerPolicy`     | `'strict-origin-when-cross-origin'` | `Referrer-Policy` with this value; `false` omits it          |
| `frameOptions`       | off                                 | `X-Frame-Options` with this value (`'DENY'`, `'SAMEORIGIN'`) |

The filter receives the resolved headers once at startup and returns the set to send, so it can also drop one. A header that the route or middleware already set is never overwritten. Raw Bun route values, such as a static `Response` in `routes`, are sent unchanged.

<Callout type="warning">

`nosniff` makes the browser trust `Content-Type`. A script or stylesheet served with a wrong or missing type is now refused instead of sniffed. Fix the type where the route builds its response, or turn the header off with `securityHeaders: { contentTypeOptions: false }`.

</Callout>

#### `X-Frame-Options`

`X-Frame-Options` is opt-in because it cannot list allowed origins: on by default, it would break every page meant to be embedded on another site. A response that already sends a CSP `frame-ancestors` directive never gets it, so one route can stay embeddable while the rest are denied:

```ts
// file: src/index.ts
import { Mochi, type Handle } from 'mochi-framework';

const embeddable: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  if (event.url.pathname.startsWith('/embed/')) {
    response.headers.set('Content-Security-Policy', "frame-ancestors 'self' https://partner.example");
  }
  return response;
};

await Mochi.serve({ securityHeaders: { frameOptions: 'DENY' }, handle: embeddable, routes });
```
