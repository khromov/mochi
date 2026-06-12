---
title: 'Server-Sent Events'
slug: server-sent-events
description: 'Push real-time updates to clients over a single HTTP connection with Mochi.sse().'
---

## Server-Sent Events

Register an SSE stream with `Mochi.sse(handler)`; the handler receives a `MochiSseStream` and the underlying `Request`, and runs once per client connection.

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/sse/time': Mochi.sse((stream) => {
      stream.send(new Date().toISOString());
      const interval = setInterval(() => {
        stream.send(new Date().toISOString());
      }, 1000);
      stream.onClose(() => clearInterval(interval));
    }),
  },
});
```

### `stream.send(data, options?)`

Push a single SSE frame to the client. `data` is a string; `options` accepts `event` (named event type) and `id` (last-event-id).

```ts
stream.send(JSON.stringify({ ok: true }), { event: 'tick', id: '42' });
```

Do **NOT** pass non-string payloads; instead, serialize objects with `JSON.stringify` before calling `send`.

### `stream.close()`

End the stream from the server side. The connection terminates and any registered `onClose` callbacks fire.

```ts
stream.send('done');
stream.close();
```

Do **NOT** leave long-running streams open without a terminal `close()` when the work is finished; instead, call `close()` so the client stops listening and resources release.

### `stream.onClose(callback)`

Register cleanup that runs when the stream ends — whether the server called `close()` or the client disconnected. Use it to clear timers, unsubscribe from event buses, and release per-connection state.

```ts
const interval = setInterval(() => stream.send('ping'), 1000);
stream.onClose(() => clearInterval(interval));
```

Do **NOT** start timers, intervals, or external subscriptions inside an SSE handler without registering a matching `onClose` cleanup; instead, pair every long-lived resource with `stream.onClose(...)` so a disconnected client doesn't leak it.

### Events

`Mochi.sse` emits `sse:open`, `sse:message`, and `sse:close` on `mochiEvents`. `logger()` prints them by default.

### Security headers

SSE responses carry the framework's baseline [security headers](/docs/security)
(`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options`), like
every other route type. `nosniff` keeps the stream from ever being reinterpreted
as another content type; the others are inert on an event stream but harmless.
Headers your handler or middleware already set are never overwritten, and
`securityHeaders: false` drops them here too.
