---
title: 'Reverse proxy'
slug: reverse-proxy
description: 'Forward a mount to an upstream origin — HTTP and WebSocket — with Mochi.proxy().'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Reverse proxy

`Mochi.proxy(config)` forwards a route mount to an upstream origin, owning **both** HTTP and WebSocket traffic for that mount. Declare it with a trailing `*` capture; the `*` portion is forwarded upstream with the matched prefix stripped.

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  routes: {
    // /p/abc/static/x.js  →  http://127.0.0.1:8001/static/x.js
    '/p/:id/*': Mochi.proxy({
      target: ({ params }) => `http://127.0.0.1:${portFor(params.id)}`,
    }),
  },
});
```

Because a proxy resolves as an ordinary route, the global [`handle` middleware](/docs/middleware/) wraps it like any other — one `basicAuth` gate covers the UI, the APIs, **and** every proxied upstream, WebSocket upgrades included.

### `target`

Resolve the upstream per request. May be async. Return one of:

- a string origin (`'http://127.0.0.1:8001'`) → forward there
- `null` → respond `502`
- a `Response` → short-circuit with your own response (custom error, redirect, …)

```ts
Mochi.proxy({
  target: ({ params }) => {
    const row = getInstance(params.id);
    return row?.status === 'running' ? `http://127.0.0.1:${row.host_port}` : null;
  },
});
```

### WebSocket

WebSocket upgrades under the mount are relayed automatically — frames are piped bidirectionally to a client connection against the upstream, buffered until it opens. Set `ws: false` to disable and reject upgrades on that mount.

<Callout type="info">

**Auth runs once, at the upgrade.** A WebSocket upgrade is an ordinary HTTP `GET`, so your `handle` middleware sees it like any request. Reject there (e.g. on a missing/invalid cookie) and the socket never connects.

</Callout>

### Subpath-hosted upstreams

Apps like code-server or Jupyter are hosted under a subpath and emit **relative** URLs, so they need the mount to end in a slash. Set `trailingSlashRedirect: true` to `308`-redirect a bare mount hit (`/p/abc`) to its slash form (`/p/abc/`). The mount is always exempt from the global `trailingSlash` policy so forwarded subpaths are never rewritten.

```ts
Mochi.proxy({
  target: ({ params }) => `http://127.0.0.1:${portFor(params.id)}`,
  trailingSlashRedirect: true,
});
```

### Options

| Option                  | Default      | Description                                                                                            |
| ----------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| `target`                | _(required)_ | Resolve the upstream: string origin, `null` → 502, or a `Response` to short-circuit.                   |
| `rewritePath`           | identity     | Map the `*` capture to the upstream path. `(rest, event) => string`.                                   |
| `ws`                    | `true`       | Relay WebSocket upgrades too.                                                                          |
| `trailingSlashRedirect` | `false`      | `308` a bare mount to its slash form; exempt the mount from the global policy.                         |
| `headers`               | —            | Mutate request headers before forwarding (after default hygiene).                                      |
| `onResponse`            | —            | Inspect/transform the upstream response before it streams back. Return a new `Response` to replace it. |
| `timeout`               | —            | Upstream connect/idle timeout in ms.                                                                   |

Mochi handles the proxy footguns for you: the matched prefix is stripped, `Host` is set to the upstream, `accept-encoding` is dropped outbound and `content-encoding`/`transfer-encoding`/hop-by-hop headers inbound (Bun's `fetch` auto-decodes), bodies stream with `redirect: 'manual'` + `duplex: 'half'`, and WS close codes are clamped to the legal set.

### Observability

Proxied requests emit a `request` event with `kind: 'proxy'` on `mochiEvents`, and `logger()` tags them `proxy`. WebSocket relays emit `ws:open`/`ws:message`/`ws:close` like any socket. See [Events](/docs/events/).

<SeeItInAction
demos={[
{ href: "/demos/proxy/", title: "Reverse proxy", hook: "Forward a mount to an in-process upstream with the prefix stripped." },
]}
/>
