---
title: 'Security'
slug: security
description: 'Built-in Mochi defenses — CSRF, WebSocket origin checks, secure cookies, redirect safety, body limits, and security headers — plus how to add a CSP.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Security

Mochi ships with safe-by-default protections. Most need no configuration in
development; a few must be told your public origin before they protect a
production deployment. The one knob that unlocks several at once is `proxy`.

<Callout type="warning">

Set <code>proxy.origin</code> (or <code>proxy.hostHeader</code>) before deploying.
Until it's set, Mochi can't know which origin to trust, so the CSRF and WebSocket
origin checks <strong>block every cross-origin state-changing request in
production</strong>. See <a href="/docs/serve-options">Serve options</a>.

</Callout>

### CSRF protection

State-changing form submissions (`POST`/`PUT`/`PATCH`/`DELETE` with a form
content type) are checked against the request `Origin`. A cross-origin submission
is rejected with `403`. This is on by default.

```ts
await Mochi.serve({
  proxy: { origin: 'https://example.com' }, // the origin to trust
  csrf: {
    trustedOrigins: ['https://admin.example.com'], // extra allowed origins
    // checkOrigin: false,                          // disable entirely (not recommended)
  },
  routes,
});
```

JSON/octet-stream API routes (`Mochi.api`) are not checked — the browser already
forces a CORS preflight to send those cross-origin.

### WebSocket origin check

`Mochi.ws` upgrades are origin-checked the same way as form POSTs — without this,
any website could open a socket to your server on a visitor's behalf
(Cross-Site WebSocket Hijacking). Cross-origin upgrades are rejected with `403`
in production once `proxy.origin`/`proxy.hostHeader` is configured; in
development a mismatch is logged but allowed. The same `csrf.trustedOrigins` and
`csrf.checkOrigin: false` escape hatches apply.

### Cookies are secure by default

Cookies set through the request `cookies` jar get `HttpOnly`, `SameSite=Lax`, and
(in production) `Secure` unless you override them:

```ts
cookies.set('session', token); // HttpOnly; SameSite=Lax; Secure (prod)

cookies.set('theme', 'dark', { httpOnly: false }); // readable by client JS
```

Change the baseline for every cookie with the `cookie:defaults` filter on
`Mochi.serve`.

### Redirect safety

A form action's `redirect()` may only point at a same-origin destination (a
relative path, or an absolute URL whose origin matches the request) or an origin
listed in `csrf.trustedOrigins`. An off-origin location is blocked with `500` in
production (logged in development), preventing open-redirect phishing when the
target is influenced by request data such as a `?next=` parameter.

```ts
return redirect(303, '/dashboard'); // ok
return redirect(303, 'https://evil.example'); // blocked unless trusted
```

### Request body size limit

Every request body is capped — by Bun at the socket layer and by a fast
Content-Length pre-check on form actions (which return `413 Payload Too Large`).
The default is 5 MB; raise it for routes that accept large uploads.

```ts
await Mochi.serve({ maxRequestBodySize: 25 * 1024 * 1024, routes }); // 25 MB
```

### Security response headers

These baseline headers are sent on every page/API response by default:

| Header                   | Value                             |
| ------------------------ | --------------------------------- |
| `X-Content-Type-Options` | `nosniff`                         |
| `Referrer-Policy`        | `strict-origin-when-cross-origin` |
| `X-Frame-Options`        | `SAMEORIGIN`                      |

Tune or disable them via the `securityHeaders` option, and add more (HSTS, CSP)
with the `security:headers` filter:

```ts
await Mochi.serve({
  securityHeaders: { frameOptions: 'DENY' }, // or `false` to drop the defaults
  filters: {
    'security:headers': (headers) => ({
      ...headers,
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    }),
  },
  routes,
});
```

A header a route or middleware already set is never overwritten.

### Content-Security-Policy (opt-in)

A useful CSP is app-specific and needs a per-request nonce for the inline
scripts Mochi emits, so it's off by default. Turn on `csp`, then read the nonce
with `getCspNonce()` and set the header yourself — typically in middleware:

```ts
import { getCspNonce } from 'mochi-framework';

const csp: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  const nonce = getCspNonce();
  if (nonce) {
    response.headers.set('Content-Security-Policy', `script-src 'nonce-${nonce}' 'strict-dynamic'; object-src 'none'; base-uri 'self'`);
  }
  return response;
};

await Mochi.serve({ csp: true, handle: csp, routes });
```

With `csp: true`, Mochi stamps the nonce on every executable `<script>` it
renders. When `csp` is off, rendered HTML is byte-for-byte unchanged.

### WebSocket resource limits

`Mochi.ws` lifecycle callbacks are framework-owned, but Bun's connection tuning
is shared across all sockets via the `websocket` serve option. Cap frame size and
slow-client buffering to resist memory-exhaustion abuse:

```ts
await Mochi.serve({
  websocket: {
    maxPayloadLength: 1 << 20, // reject frames over 1 MB
    backpressureLimit: 1 << 20, // buffered-send ceiling per socket
    closeOnBackpressureLimit: true, // drop a client that can't keep up
    idleTimeout: 120, // seconds
  },
  routes,
});
```

For high-throughput sends, implement the `drain` callback in your `Mochi.ws`
handler to resume only when the socket's buffer clears.
