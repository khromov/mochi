# Reverse-proxy without `Mochi.proxy()` — just wildcard routes

You don't need the `Mochi.proxy()` route kind to reverse-proxy a mount (HTTP **and**
WebSocket) to an upstream. The Bun in this repo (1.3.14) already matches wildcard routes
(`/p/:id/*`), and Mochi already exposes the two escape hatches you need: a route handler
receives the Bun `server` object, and the framework dispatches every socket by an internal
route key on `ws.data`. This guide shows the hand-rolled version `Mochi.proxy()` wraps.

It is **three route entries**.

## The pieces

| Pattern       | Kind        | Job                                                                            |
| ------------- | ----------- | ------------------------------------------------------------------------------ |
| `/p/:id/*`    | `Mochi.api` | Serve **all** HTTP under the mount, and **initiate** WS upgrades.              |
| `/__proxy_ws` | `Mochi.ws`  | A **sentinel** route that parks the relay handlers in Mochi's `wsHandlersMap`. |
| `/p/:id`      | function    | A `308` to `/p/:id/` for subpath-hosted upstreams (optional).                  |

### Why each one

1. **`/p/:id/*` (`Mochi.api`)** — Bun routes a WebSocket upgrade (an HTTP `GET` carrying
   `Upgrade: websocket`) to this handler too, so you branch on the header. A wildcard route
   gives you `params.id` but **not** the `*` capture — derive the forwarded path by stripping
   the mount prefix from `url.pathname` yourself.
2. **`/__proxy_ws` (`Mochi.ws`)** — Mochi builds a single Bun `websocket` handler that
   dispatches each socket by `ws.data.__mochiRoutePattern`, and only attaches it when at least
   one `Mochi.ws` route exists. Registering this sentinel both (a) makes the dispatcher exist
   and (b) gives you a key to upgrade proxied sockets under. Clients never hit it directly.
   Per-socket state (the upstream `WebSocket`, a pre-open buffer) lives on `ws.data`.
3. **`/p/:id` (redirect)** — code-server / Jupyter emit **relative** URLs, so the mount must
   end in a slash. `/p/:id/*` does not match the bare `/p/abc`, so add a one-line `308`.

## The code

```ts
// file: src/proxy.server.ts
import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

const SENTINEL = '/__proxy_ws';

// Replace with your real lookup. Return an origin like 'http://127.0.0.1:8001', or null.
function upstreamFor(id: string): string | null {
  const row = getInstance(id);
  return row?.status === 'running' ? `http://127.0.0.1:${row.host_port}` : null;
}

// '/p/abc/static/x.js' -> '/static/x.js'  (strip the '/p/:id' prefix)
function restOf(pathname: string, id: string): string {
  return pathname.slice(`/p/${id}`.length) || '/';
}

// Close codes a client may legally send: 1000, or the app range 3000–4999.
function clampCloseCode(code: number): number {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000;
}

export const proxyRoutes: Record<string, MochiRouteValue> = {
  // (Optional) subpath-hosted upstreams need the trailing slash.
  '/p/:id': (req) => {
    const u = new URL(req.url);
    return new Response(null, { status: 308, headers: { Location: u.pathname + '/' + u.search } });
  },

  // All HTTP under the mount + WS upgrade initiation.
  '/p/:id/*': Mochi.api(async (event) => {
    const origin = upstreamFor(event.params.id);
    if (!origin) return new Response('No upstream', { status: 502 });

    const rest = restOf(event.url.pathname, event.params.id);

    // A WS upgrade routes here too — hand it off to the sentinel relay.
    if ((event.request.headers.get('upgrade') ?? '').toLowerCase() === 'websocket') {
      const scheme = origin.startsWith('https') ? 'wss' : 'ws';
      const upstreamWs = `${scheme}://${origin.replace(/^https?:\/\//, '')}${rest}${event.url.search}`;
      const ok = event.server.upgrade(event.request, {
        data: {
          __mochiRoutePattern: SENTINEL, // <- routes the socket to the relay handlers below
          __mochiOpenedAt: performance.now(),
          __mochiPath: event.url.pathname,
          user: { upstreamWs, buffer: [] as Array<string | Buffer> },
        },
      });
      if (!ok) return new Response('upgrade failed', { status: 500 });
      // Harmless sentinel: Bun ignores the response once the socket is hijacked.
      return new Response(null, { status: 101 });
    }

    // Plain HTTP — stream to upstream with the well-known proxy header hygiene.
    const out = new Headers(event.request.headers);
    out.delete('accept-encoding'); // Bun's fetch auto-decodes; don't forward the client's value
    out.set('host', new URL(origin).host);

    const upstream = await fetch(`${origin}${rest}${event.url.search}`, {
      method: event.request.method,
      headers: out,
      body: event.request.body,
      redirect: 'manual',
      ...(event.request.body ? { duplex: 'half' } : {}),
    } as RequestInit);

    const inn = new Headers(upstream.headers);
    inn.delete('content-encoding'); // body is already decoded
    inn.delete('transfer-encoding');
    inn.delete('content-length');
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: inn });
  }),

  // Sentinel relay: stateless across sockets; per-socket state is on ws.data.user.
  [SENTINEL]: Mochi.ws<{ upstreamWs: string; buffer: Array<string | Buffer> }>({
    open(ws) {
      const state = ws.data.user;
      const client = new WebSocket(state.upstreamWs);
      client.binaryType = 'arraybuffer';
      (ws.data as { client?: WebSocket }).client = client;

      client.onopen = () => {
        for (const frame of state.buffer) client.send(frame as string | ArrayBuffer);
        state.buffer = [];
      };
      client.onmessage = (e) => ws.send(e.data as string | ArrayBuffer);
      client.onclose = (e) => {
        try {
          ws.close(clampCloseCode(e.code), e.reason);
        } catch {
          /* already closing */
        }
      };
      client.onerror = () => {
        try {
          ws.close(1011);
        } catch {
          /* already closing */
        }
      };
    },
    message(ws, msg) {
      const client = (ws.data as { client?: WebSocket }).client;
      if (client && client.readyState === WebSocket.OPEN) client.send(msg as string | ArrayBuffer);
      else ws.data.user.buffer.push(msg); // upstream not open yet — buffer
    },
    close(ws) {
      try {
        (ws.data as { client?: WebSocket }).client?.close();
      } catch {
        /* already closing */
      }
    },
  }),
};
```

Then mount it in `Mochi.serve({ routes: { ...proxyRoutes } })`.

## Things to get right

- **Middleware composes for free.** Because the proxy resolves as ordinary routes, your global
  `handle` hook wraps them — one `basicAuth` middleware gates the UI, the APIs, **and** every
  proxied upstream. A WS upgrade is a normal `GET`, so the same middleware authenticates it;
  reject there and the socket never connects.
- **Trailing slash.** If you set a global `trailingSlash` policy, exempt the mount via the
  `trailingSlash:redirect` extension filter (or don't set a global policy — the api route won't
  strip slashes unless one is configured). The bare-mount `308` above handles the relative-URL
  case either way.
- **`ws.data` typing.** The relay stashes the upstream `WebSocket` on `ws.data`. The
  framework's `MochiWsData` reserves `__mochiRoutePattern` / `__mochiOpenedAt` / `__mochiPath`;
  your `upgrade`/`server.upgrade` payload is exposed as `ws.data.user`.
- **Close-code hygiene.** A browser-facing `close()` only accepts `1000` or `3000–4999`. Clamp
  upstream codes (e.g. `1006`/`1011`) or `close()` throws.

## What `Mochi.proxy()` adds over this

Nothing you can't do by hand — it just deletes the boilerplate: the sentinel `Mochi.ws` route,
the `__mochiRoutePattern` wiring, the throwaway `101` response, the header hygiene, the
close-code clamp, and the second/third route entries all collapse into one declarative mount:

```ts
'/p/:id/*': Mochi.proxy({
  target: ({ params }) => upstreamFor(params.id),
  trailingSlashRedirect: true,
}),
```

See `packages/docs/112-reverse-proxy.md` for the full option surface.
