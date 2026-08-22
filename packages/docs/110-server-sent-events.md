---
title: 'Server-Sent Events'
slug: server-sent-events
description: 'Push real-time updates to clients over a single HTTP connection with Mochi.sse().'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Server-Sent Events

Register an SSE stream with `Mochi.sse(handler)`. The handler receives a `MochiSseStream` and the underlying `Request`, and runs once per client connection.

Only `GET` is accepted. Every other method returns `405 Method Not Allowed` with `Allow: GET` without invoking the handler. Global [`handle` middleware](/docs/middleware/) runs before the method check and stream handler.

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

<Callout type="warning">

[`trailingSlash`](/docs/trailing-slash/) does not apply to SSE routes, so connect to exactly the pattern you declared.

</Callout>

### `stream.send(data, options?)`

Push one SSE frame to the client. `data` is a string. `options` accepts `event` (named event type) and `id` (last-event-id).

```ts
stream.send(JSON.stringify({ ok: true }), { event: 'tick', id: '42' });
```

Newlines in `data` are encoded as separate `data:` lines, including bare carriage returns. `event` and `id` must not contain CR or LF; `send` throws and Mochi closes the stream if they do. These rules prevent user-controlled strings from injecting additional SSE fields.

### `stream.close()`

End the stream from the server. The connection terminates and every registered `onClose` callback fires.

<Callout type="warning">

**Call `close()` when a stream is finished.** Leaving a long-running stream open keeps the client listening and holds resources. Call `close()` to release them.

</Callout>

### `stream.onClose(callback)`

Register cleanup that runs when the stream ends — whether the server called `close()` or the client disconnected. Use it to clear timers, unsubscribe from event buses, and release per-connection state.

<Callout type="warning">

**Pair every long-lived resource with `onClose`.** A timer or subscription with no matching cleanup leaks on each disconnect:

```ts
const sub = bus.subscribe(onTick);
stream.onClose(() => sub.unsubscribe());
```

</Callout>

### Events

`Mochi.sse` emits `sse:open`, `sse:message`, and `sse:close` on `mochiEvents`. `consoleLogger()` prints them by default.

<SeeItInAction
demos={[{ href: "/demos/streams/", title: "Real-time Streams", hook: "How server-sent events and WebSocket streaming work — live SSE and WebSocket clocks, lazily hydrated via mochi:hydrate:visible." }]}
/>
