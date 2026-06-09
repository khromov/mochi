---
title: 'WebSocket routes'
slug: websocket-routes
description: 'Register WebSocket endpoints with Mochi.ws() and handle upgrade, open, message, close, and drain events.'
---

## WebSocket routes

`Mochi.ws(handlers)` registers a WebSocket endpoint backed by Bun's `ServerWebSocket`. The handler map carries five callbacks — `upgrade`, `open`, `message`, `close`, `drain` — and exposes Bun's pub/sub primitives (`ws.subscribe`, `ws.publish`, `ws.unsubscribe`) on the socket.

Upgrades are origin-checked by default (cross-origin upgrades are rejected in production once `proxy.origin` is set), and per-socket resource limits are configured via the `websocket` serve option. See [Security](/docs/security).

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

Do **NOT** authenticate inside `message` and silently drop messages from unauthenticated sockets; instead, reject the upgrade in `upgrade` so the client never establishes the connection.

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

Do **NOT** run long synchronous work or unbounded `await` chains inside `message`; instead, hand work off to a queue or `setImmediate` — the callback is on the connection's read path and blocks subsequent frames.

### `close`

Fires once when the socket closes, with the close `code` and `reason`. Use it to release per-connection state and unsubscribe from topics.

```ts
close(ws, code, reason) {
  ws.unsubscribe('chat');
}
```

Do **NOT** call `ws.send` or `ws.publish` from inside `close` (or any time after the socket has closed); instead, treat `close` as terminal — sends to a closed socket throw and pub/sub from a closed socket is a no-op.

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

Do **NOT** write to the `__mochi*` fields on `ws.data`; instead, keep your own values under the `user` shape returned from `upgrade`.

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

Do **NOT** assume `ws.publish` echoes back to the sender; instead, call `ws.send` alongside `ws.publish` if the publisher should also receive the message.

### Lifecycle events

Every WebSocket emits `ws:open`, `ws:message`, and `ws:close` on `mochiEvents`. `logger()` already prints them. See `Events` for the full payload shape and how to add custom subscribers.
