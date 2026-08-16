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

Only `message` is required.

<Callout type="warning">

[`trailingSlash`](/docs/trailing-slash/) does not apply to WebSocket routes, so connect to exactly the pattern you declared. A mismatched slash surfaces as an opaque connection error, not a visible 404.

</Callout>

### `upgrade`

Runs once per HTTP upgrade request. Return a value to attach to `ws.data.user`, or return `false` to reject the connection. The route's URL params are the second argument.

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

**Reject unauthenticated sockets in `upgrade`, not `message`.** Authenticating inside `message` still lets the connection establish. Return `false` from `upgrade` so the client never connects.

</Callout>

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

Fires when the socket's send buffer drains after a backpressured `ws.send`. Resume queued writes here.

### `ws.data`

Each socket carries a typed `data` object. Mochi reserves the internal fields `__mochiRoutePattern`, `__mochiOpenedAt`, and `__mochiPath`. Your `upgrade` return value is exposed as `ws.data.user`.

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

Every socket exposes `ws.subscribe(topic)`, `ws.publish(topic, data)`, and `ws.unsubscribe(topic)`. To broadcast from outside a handler, capture the `server` returned by `Mochi.serve()` and call `server.publish(topic, data)`.

<Callout type="info">

**`ws.publish` does not echo to the sender.** It delivers only to other subscribers. Call `ws.send` alongside `ws.publish` if the publisher should also receive the message.

</Callout>

### Lifecycle events

Every WebSocket emits `ws:open`, `ws:message`, and `ws:close` on `mochiEvents`. `consoleLogger()` prints them. See [Events](/docs/events/) for the payload shape.

<SeeItInAction
demos={[
{ href: "/demos/chat/", title: "Real-time Chat", hook: "How WebSocket routes work — a hydrated island over Mochi.ws() with pub/sub broadcast and in-memory history." },
{ href: "/demos/streams/", title: "Real-time Streams", hook: "How server-sent events and WebSocket streaming work — live SSE and WebSocket clocks, lazily hydrated via mochi:hydrate:visible." },
]}
/>
