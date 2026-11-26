---
title: 'Security'
slug: security
description: 'The protections Mochi turns on by default, the ones you opt into, and how to change them.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Security

Mochi turns on a few protections by default and offers others as options. This page lists what each one does and how to change it.

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

### Content-Security-Policy nonce

<VersionNote since="0.10.0" message="The csp option and getCspNonce() are new in 0.10.0." />

A strict `Content-Security-Policy` keeps an injected `<script>` from running, but Mochi's own inline scripts would need `'unsafe-inline'` to get through. `csp: true` stamps a fresh nonce on every script Mochi emits, so a nonce-only `script-src` works:

```ts
// file: src/index.ts
await Mochi.serve({ csp: true, handle: cspHeader, routes });
```

Mochi sends no policy itself: `cspHeader` is your middleware, which sets the header with the nonce from [`getCspNonce()`](/docs/request-context/#getcspnonce). [Content-Security-Policy nonce](/docs/serve-options/#content-security-policy-nonce) has that middleware, the scripts that get the nonce, and why HTML rendered with `csp` on must not be cached.

### WebSocket origin check

<VersionNote since="0.10.0" message="Earlier versions accepted WebSocket upgrades from any origin." />

Browsers apply neither the same-origin policy nor CORS to a WebSocket handshake, so any website could open a socket to a `Mochi.ws()` route with your visitor's cookies and read every frame. Mochi answers `403` to an upgrade whose `Origin` is not the host the socket connects to, the public origin, or an entry in `csrf.trustedOrigins`. The check runs in development too, where it also guards the live-reload socket. Allow another origin of your own:

```ts
await Mochi.serve({ csrf: { trustedOrigins: ['https://widget.example.com'] }, routes });
```

See [Origin check](/docs/websocket-routes/#origin-check).

### Redirects

<VersionNote since="0.10.0" message="The redirect guard is new in 0.10.0. Earlier versions sent any redirect() location as given." />

An open redirect lets a link on your domain, such as `/login/?next=https://evil.example`, send visitors to a lookalike site. In production, `redirect()` from a form action or `serverProps` fails with `500` when the location is an `http:` or `https:` URL on another origin; development sends it with a warning. Same-origin means `proxy.origin` or `proxy.hostHeader` when set, and the request's own `Host` otherwise. List the origins you redirect to, or waive the check for one location your own code builds:

```ts
await Mochi.serve({ redirect: { trustedOrigins: ['https://accounts.example.com'] }, routes });
return redirect(303, tenant.ssoUrl, { external: true });
```

A control character, a URL that does not parse, or a script-capable scheme such as `javascript:` fails in every mode, `{ external: true }` included. See [Redirects](/docs/serve-options/#redirects).

### Secure cookies

<VersionNote since="0.10.0" message="The secureCookies option is new in 0.10.0." />

`secureCookies` gives every cookie the app sets `HttpOnly` and `SameSite=Lax`, plus `Secure` outside development. `HttpOnly` keeps a session cookie away from injected scripts, and `Secure` keeps it off plain-HTTP connections. It is off by default:

```ts
await Mochi.serve({ secureCookies: true, routes });
```

A cookie that an island reads or writes then needs `{ httpOnly: false }` where the server sets it. The `cookie:defaults` filter receives these fields, and its return value replaces them instead of merging with them: spread its input to keep the fields you do not change. See [Secure cookies](/docs/serve-options/#secure-cookies).

### Cookie warnings in the browser

<VersionNote since="0.10.0" message="The browser cookie jar warnings are new in 0.10.0." />

A browser cannot set `HttpOnly` from a script, and it drops some `document.cookie` writes without an error, so a cookie meant to be hidden from scripts can end up readable, and a logout `delete()` can leave the cookie in place. In development, the browser `cookies` jar warns in the console and the debug bar when a call passes `httpOnly`, and when a `set()` or `delete()` has no effect:

```ts
cookies.set('session', token, { httpOnly: true }); // in an island: warns, then writes the cookie without HttpOnly
```

There is nothing to configure, and production builds ship none of these checks. See [`cookies`](/docs/request-context/#cookies).

### Remote image fetches

<VersionNote since="0.10.0" message="image.maxConcurrentFetches and the per-host share are new in 0.10.0. Earlier versions started every remote source fetch at once." />

A remote image source fetch can hold about twice `maxResponseBytes` in memory, so a burst of uncached image URLs could exhaust the server. At most `image.maxConcurrentFetches` remote fetches run at once per process, and one host gets at most half of them, so one slow upstream cannot hold every slot. The wait for a slot counts against `fetchTimeoutMs`, and a fetch that gets no slot in time fails with `503`:

```ts
await Mochi.serve({ image: { maxConcurrentFetches: 16 }, routes }); // default 8
```

See [Remote fetch limits](/docs/images/#remote-fetch-limits).
