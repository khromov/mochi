---
title: 'HTTP streaming'
slug: http-streaming
description: 'Mochi renders each page as a complete document, with SSE, WebSockets, and server islands for anything that arrives later.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## HTTP streaming

Mochi renders each page as one complete document. Svelte's `render` from `svelte/server` runs to completion, then the HTML ships as a single `text/html` Response. One render pass, no out-of-order chunks to coordinate, deterministic markup every time.

<Callout type="info">

The trade-off is that a page holds its response until everything it awaits has resolved — a 2-second upstream call delays the whole page by 2 seconds. Push slow or personalized work to the tools below so the shell ships immediately.

</Callout>

### Streaming primitives

- `Mochi.sse(handler)` — Server-Sent Events. The response body is a `ReadableStream` and `stream.send(...)` pushes events as they happen.
- `Mochi.ws(handlers)` — WebSockets via `Bun.serve` upgrade. Bidirectional, message-by-message.

Reach for these to layer realtime UI on top of an already-rendered page.

### Keeping pages fast

- **Server islands** (`mochi:defer`) load slow or personalized fragments out-of-band after the shell ships. The rest of the page renders immediately; the island fetches itself once the browser sees the placeholder.
- **Visible hydration** (`mochi:hydrate:visible`) keeps the initial JS payload small.
- **Shared HTTP cache** (Cloudflare, CloudFront, Fastly, Varnish, nginx) in front of the origin makes render time irrelevant for the cacheable common case. Server islands can stay uncached behind a cached shell — see `Cache`.
