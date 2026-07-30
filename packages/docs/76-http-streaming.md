---
title: 'HTTP streaming'
slug: http-streaming
description: 'Mochi renders each page as one complete document. Use SSE, WebSockets, and server islands for anything that arrives later.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## HTTP streaming

Mochi renders each page as one complete document, then ships the HTML as a single `text/html` response.

<Callout type="info">

A page holds its response until everything it awaits resolves. A 2-second upstream call delays the whole page by 2 seconds. Push slow or personalized work to the tools below so the shell ships immediately.

</Callout>

### Streaming primitives

- `Mochi.sse(handler)` — Server-Sent Events. The response body is a `ReadableStream`. `stream.send(...)` pushes events as they happen.
- `Mochi.ws(handlers)` — WebSockets over the `Bun.serve` upgrade. Bidirectional, message by message.

Use these to layer real-time UI on top of a rendered base page.

### Keeping pages fast

- **Server islands** (`mochi:defer`) load slow or personalized fragments out-of-band after the shell ships. The island fetches itself once the browser sees the placeholder.
- **Visible hydration** (`mochi:hydrate:visible`) keeps the initial JavaScript payload small.
- **Shared HTTP cache** (Cloudflare, CloudFront, Fastly, Varnish, nginx) in front of the origin makes render time irrelevant for the cacheable case. A server island can stay uncached behind a cached shell — see [Cache](/docs/cache/).

<SeeItInAction
demos={[{ href: "/demos/streams/", title: "Real-time Streams", hook: "How server-sent events and WebSocket streaming work — live SSE and WebSocket clocks, lazily hydrated via mochi:hydrate:visible." }]}
/>
