---
title: 'WebSocket routes'
slug: websocket-routes
description: 'Register WebSocket endpoints with Mochi.ws() and handle upgrade, open, message, close, and drain events.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## WebSocket routes

`Mochi.ws(handlers)` registers a WebSocket endpoint backed by Bun's `ServerWebSocket`. The handler map carries five callbacks — `upgrade`, `open`, `message`, `close`, `drain` — and exposes Bun's pub/sub primitives (`ws.subscribe`, `ws.publish`, `ws.unsubscribe`) on the socket.

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/ws/chat': Mochi.ws({
      open(ws) {
        ws.subscribe('chat');
      },
      message(ws, message) {
        ws.publish('chat', String(message));
        ws.send(String(message));
      },
      close(ws) {
        ws.unsubscribe('chat');
      },
    }),
  },
});
```

Only `message` is required; the rest are optional.

### Origin protection

Mochi checks every WebSocket handshake's `Origin` header before upgrading. By default the header is required and must exactly match the proxy-aware public origin. This prevents a hostile web page from opening an authenticated socket with the victim's ambient cookies.

Pass a second options object to `Mochi.ws` when the route intentionally accepts other origins:

```ts
Mochi.ws(
  {
    message(ws, message) {
      ws.send(message);
    },
  },
  {
    trustedOrigins: ['https://admin.example.com'],
    // allowMissingOrigin: true, // opt in for non-browser clients
    // checkOrigin: false,       // disable all Origin checks
  },
);
```

Origins must be absolute `http://` or `https://` origins without credentials, paths, queries, or fragments. Invalid configuration fails at startup. When Mochi is behind a reverse proxy, configure [`proxy.origin` or trusted forwarded headers](/docs/serve-options/#proxy) so the expected public origin is correct.

<Callout type="danger">

**Do not disable the check just because the socket has authentication.** Browsers attach cookies to cross-site WebSocket handshakes. Use `trustedOrigins` for known browser frontends and `allowMissingOrigin` only for clients that cannot send `Origin`.

</Callout>

### `upgrade`

Runs once per HTTP upgrade request. Return a value to attach to `ws.data.user`, or return `false` to reject the connection. The route's URL params are passed as the second argument.

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/ws/:room': Mochi.ws<{ userId: string; room: string }>({
      upgrade(req, params) {
        const userId = req.headers.get('x-user-id');
        if (!userId) return false; // reject the upgrade
        return { userId, room: params.room };
      },
      message(ws, msg) {
        console.log(ws.data.user.userId, ws.data.user.room, msg);
      },
    }),
  },
});
```

<Callout type="warning">

**Reject unauthenticated sockets in `upgrade`, not `message`.** Authenticating inside `message` and dropping frames still lets the connection establish. Return `false` from `upgrade` so the client never connects.

</Callout>

Global [`handle` middleware](/docs/middleware/) runs before Origin validation and `upgrade`, so shared session/auth middleware can reject the handshake consistently with pages, APIs, files, SSE, and server islands.

### `open`

Fires once after a successful upgrade. Use it to subscribe the socket to topics or seed per-connection state.

```ts
open(ws) {
  ws.subscribe('chat');
}
```

### `message`

Fires for every inbound frame. The payload is `string | Buffer` — coerce or decode it before use.

```ts
message(ws, message) {
  ws.publish('chat', String(message));
}
```

<Callout type="warning">

**Keep `message` fast.** Slow work inside `message` holds up the next message from the same socket. Hand long tasks off to a queue or background task so the handler returns quickly.

</Callout>

### `close`

Fires once when the socket closes, with the close `code` and `reason`. Use it to release per-connection state and unsubscribe from topics.

```ts
close(ws, code, reason) {
  ws.unsubscribe('chat');
}
```

### `drain`

Fires when the socket's send buffer has drained after a backpressured `ws.send`. Resume queued writes here.

```ts
drain(ws) {
  // resume buffered sends
}
```

### `ws.data`

Each socket carries a typed `data` object. Mochi reserves the internal fields `__mochiRoutePattern`, `__mochiOpenedAt`, and `__mochiPath`; your `upgrade` return value is exposed as `ws.data.user`.

```ts
Mochi.ws<{ userId: string }>({
  upgrade(req) {
    const userId = req.headers.get('x-user-id');
    return userId ? { userId } : false;
  },
  message(ws) {
    console.log(ws.data.user.userId);
  },
});
```

### Pub/sub

Every socket exposes Bun's pub/sub primitives: `ws.subscribe(topic)`, `ws.publish(topic, data)`, `ws.unsubscribe(topic)`. To broadcast from outside a handler, capture the `server` returned by `Mochi.serve()` and call `server.publish(topic, data)`.

```ts
open(ws) {
  ws.subscribe('chat');
},
message(ws, msg) {
  ws.publish('chat', String(msg)); // fan out to every other subscriber
},
```

<Callout type="info">

**`ws.publish` does not echo to the sender.** It delivers only to other subscribers. Call `ws.send` alongside `ws.publish` if the publisher should also receive the message.

</Callout>

### Lifecycle events

Every WebSocket emits `ws:open`, `ws:message`, and `ws:close` on `mochiEvents`. `logger()` already prints them. See `Events` for the full payload shape and how to add custom subscribers.

<SeeItInAction
demos={[
{ href: "/demos/chat/", title: "Real-time Chat", hook: "How WebSocket routes work — a hydrated island over Mochi.ws() with pub/sub broadcast and in-memory history." },
{ href: "/demos/streams/", title: "Real-time Streams", hook: "How server-sent events and WebSocket streaming work — live SSE and WebSocket clocks, lazily hydrated via mochi:hydrate:visible." },
]}
/>
