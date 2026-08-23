---
title: 'Security'
slug: security
description: 'Built-in Mochi defenses — CSRF, WebSocket origin checks, redirect safety, security headers, secure cookies — plus how to add a CSP.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Security

Mochi ships with safe-by-default protections. Most need no configuration in development; a few must be told your public origin before they protect a production deployment. The one knob that unlocks several at once is `proxy`.

<Callout type="warning">

Set `proxy.origin` (or `proxy.hostHeader`) before deploying. Until it is set, Mochi cannot know which origin to trust, so the CSRF and WebSocket origin checks **block every cross-origin state-changing request in production**, and the redirect guard blocks every absolute `redirect()` target. See [Serve options](/docs/serve-options/).

</Callout>

### CSRF protection

State-changing form submissions (`POST`/`PUT`/`PATCH`/`DELETE` with a form content type) are checked against the request `Origin`. A cross-origin submission is rejected with `403`. This is on by default.

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

JSON/octet-stream API routes (`Mochi.api`) are not checked — the browser already forces a CORS preflight to send those cross-origin.

### WebSocket origin check

<VersionNote since="0.10.0" message="The WebSocket upgrade origin check is new." />

`Mochi.ws` upgrades are origin-checked the same way as form POSTs. Without it, any website could open a socket to your server on a visitor's behalf and ride their cookies (Cross-Site WebSocket Hijacking). Cross-origin upgrades are rejected with `403` in production once `proxy.origin`/`proxy.hostHeader` is configured; in development a mismatch is logged but allowed. The same `csrf.trustedOrigins` and `csrf.checkOrigin: false` escape hatches apply.

Upgrades **without** an `Origin` header are always allowed. Browsers always send `Origin` on upgrade requests and are the only clients that attach ambient credentials, so a missing header means a non-browser client — server-to-server, native apps, CLIs like `wscat` — that CSWSH cannot exploit.

### Redirect safety

<VersionNote since="0.10.0" message="The redirect guard is new." />

`redirect()` may only point at a same-origin destination — a relative path, or an absolute URL whose origin matches the request — or an origin listed in `redirect.trustedOrigins`. An off-origin location is blocked with `500` in production and logged in development, preventing open-redirect phishing when the target is influenced by request data such as a `?next=` parameter.

```ts
return redirect(303, '/dashboard'); // ok
return redirect(303, 'https://evil.example'); // blocked unless trusted
```

Allow a legitimate off-origin destination — an identity provider, say — with its own list:

```ts
await Mochi.serve({
  redirect: { trustedOrigins: ['https://accounts.google.com'] },
  routes,
});
```

Or waive the guard for one call, when the destination is not known ahead of time:

```ts
return redirect(303, `${tenant.ssoEndpoint}?state=${state}`, { external: true });
```

<Callout type="danger">

`{ external: true }` says _this location is mine, not the visitor's_. Only ever pass it for a URL your own code builds. The moment the location comes from request data — a `?next=` param, a form field, a header — it is the open redirect the guard exists to stop, and the flag hands the attacker exactly what the allow-list denies them.

</Callout>

Header-injection checks are not waivable: a location containing control characters is rejected either way, since it could split the response.

<Callout type="info">

This is deliberately **not** `csrf.trustedOrigins`. That list says which origins may send _your server_ a form POST; this one says where your server may send _its visitors_. Adding an OAuth provider to the CSRF list to fix a redirect would let it post to every protected route of yours.

</Callout>

The guard covers `redirect()` from a form action and from `serverProps`. Framework-internal redirects — trailing-slash and proxy canonicalisation — build their own target and are unaffected.

<Callout type="warning">

Without `proxy.origin`/`proxy.hostHeader`, the only evidence of your own origin is the client's `Host` header, which an attacker sets freely. Production therefore blocks **every** absolute location until one is configured — relative paths keep working. This matches the CSRF check's rule.

</Callout>

### Security response headers

<VersionNote since="0.10.0" message="securityHeaders and the security:headers filter are new." />

These headers are sent on every framework response (pages, APIs, server islands, SSE streams, `Mochi.file` routes, `publicDir` files, and error pages) by default:

| Header                   | Value                             |
| ------------------------ | --------------------------------- |
| `X-Content-Type-Options` | `nosniff`                         |
| `Referrer-Policy`        | `strict-origin-when-cross-origin` |

`X-Frame-Options` is **opt-in**. It cannot express an allow-list, so sending it by default would break any page meant to be embedded cross-origin. Set it only when a blanket deny is what you want:

```ts
await Mochi.serve({
  securityHeaders: { frameOptions: 'SAMEORIGIN' }, // or 'DENY', or `false` to drop all defaults
  filters: {
    'security:headers': (headers) => ({
      ...headers,
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    }),
  },
  routes,
});
```

<Callout type="info">

Prefer CSP `frame-ancestors` when some origins may frame you and others may not — it is an allow-list, `X-Frame-Options` is not. A response that already carries a `frame-ancestors` policy never gets `X-Frame-Options` stamped on it, so an embeddable route keeps working even with `frameOptions` on.

</Callout>

A header a route or middleware already set is never overwritten.

<Callout type="warning">

`staticDirs` mounts are the exception: they are served by Bun's own directory router (for ETag, `304` and range support), which has no hook for extra response headers. Serve files that need `nosniff` through `publicDir`, or add the headers at your reverse proxy.

</Callout>

### Secure cookies

<VersionNote since="0.10.0" message="The secureCookies option is new." />

`secureCookies: true` gives every cookie set through the request jar a hardened baseline — `HttpOnly`, `SameSite=Lax`, and (outside development) `Secure`:

```ts
await Mochi.serve({ secureCookies: true, routes });

cookies.set('session', token); // HttpOnly; SameSite=Lax; Secure (prod)
cookies.set('theme', 'dark', { httpOnly: false }); // readable by client JS
```

It is off by default, because `HttpOnly` hides server-set cookies from client JS and existing apps may read them. Override per cookie as above, or change the baseline for every cookie with the `cookie:defaults` filter.

### Request body size limit

Bun caps request bodies at 128 MB. Lower it through the `bun` escape hatch — an oversized body is rejected at the socket layer with `413`, before your handler runs:

```ts
await Mochi.serve({ bun: { maxRequestBodySize: 5 * 1024 * 1024 }, routes }); // 5 MB
```

### Content-Security-Policy (opt-in)

<VersionNote since="0.10.0" message="The csp option and getCspNonce() are new." />

A useful CSP is app-specific and needs a per-request nonce for the inline scripts Mochi emits, so it is off by default. Turn on `csp`, then read the nonce with `getCspNonce()` and set the header yourself — typically in middleware:

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

With `csp: true`, Mochi stamps the nonce on every executable `<script>` it renders, including the ones on the fall-through `404` page. Data blocks (`<script type="application/json">`, island props) carry no nonce — CSP does not gate them, because nothing executes. Scripts your own components emit are never stamped — give them the nonce yourself. When `csp` is off, rendered HTML is byte-for-byte unchanged.

<Callout type="warning">

Keep `'strict-dynamic'` in a nonce-based policy. Every hydratable island is loaded through a dynamic `import()` from the already-trusted bootstrap, and a deferred server island fetches a fragment whose scripts carry a _different_ nonce than the page's header — under a nonce-only policy both are blocked, so islands silently never hydrate.

</Callout>

<Callout type="info">

Responses returned before middleware runs — the protection interstitial, the CSRF `403`, trailing-slash redirects — never reach a `handle` that sets the header, so they ship without your CSP. Add one for those through the `security:headers` filter if you need it.

</Callout>

### WebSocket resource limits

`Mochi.ws` lifecycle callbacks are framework-owned, but Bun's connection tuning is shared across all sockets via the `websocket` serve option. Cap frame size and slow-client buffering to resist memory-exhaustion abuse:

```ts
await Mochi.serve({
  websocket: {
    maxPayloadLength: 1 << 20, // reject frames over 1 MB
    backpressureLimit: 1 << 20, // buffered-send ceiling per socket
    closeOnBackpressureLimit: true, // drop a client that cannot keep up
    idleTimeout: 120, // seconds
  },
  routes,
});
```

For high-throughput sends, implement the `drain` callback in your `Mochi.ws` handler to resume only when the socket's buffer clears. Only `open`/`message`/`close`/`drain` are framework-owned; `ping`/`pong` belong to you and reach Bun unchanged.
