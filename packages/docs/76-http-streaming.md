---
title: 'HTTP streaming'
slug: http-streaming
description: 'Mochi renders pages to completion before sending; SSE and WebSocket are the streaming alternatives.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## HTTP streaming

Mochi does not stream HTML responses. Every page renders to completion via Svelte's `render` from `svelte/server`, then ships as a single `text/html` Response.

<Callout type="warning">

**No progressive HTML.** Slow data inside a page blocks the entire response. There is no `flushSync`, no out-of-order chunks, no `<Suspense>` over the network. If a page awaits a 2-second upstream call, the client waits 2 seconds before seeing any bytes.

</Callout>

### What does stream

- `Mochi.sse(handler)` — Server-Sent Events. The response body is a `ReadableStream` and `stream.send(...)` pushes events as they happen.
- `Mochi.ws(handlers)` — WebSockets via `Bun.serve` upgrade. Bidirectional, message-by-message.

Use these for realtime UI on top of an already-rendered page; do **NOT** reach for them as a replacement for streamed SSR.

### Workarounds for slow pages

- **Server islands** (`mochi:defer`) load slow or personalized fragments out-of-band after the shell ships. The rest of the page renders immediately; the island fetches itself once the browser sees the placeholder.
- **Visible hydration** (`mochi:hydrate:visible`) keeps the initial JS payload small without progressive HTML.
- **Shared HTTP cache** (Cloudflare, CloudFront, Fastly, Varnish, nginx) in front of the origin makes render time irrelevant for the cacheable common case. Server islands can stay uncached behind a cached shell — see `Cache`.

Do **NOT** add an artificial loading screen to mask slow `serverProps`; instead, move the slow fetch into a `mochi:defer` island so the rest of the page paints immediately.
