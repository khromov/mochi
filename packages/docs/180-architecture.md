---
title: 'Architecture'
slug: architecture
---

## Architecture

Framework source lives in `packages/mochi/src/`; the demo site that consumes it lives in `packages/site/src/`. The files you reach for most often:

- `packages/site/src/index.ts` — HTTP server entry point; calls `Mochi.serve()`.
- `packages/site/src/routes.ts` — route definitions for the demo site.
- `packages/mochi/src/Mochi.ts` — `Mochi.serve()`, `Mochi.page()`, `Mochi.api()`, `Mochi.ws()`, `Mochi.sse()`.
- `packages/mochi/src/ComponentRegistry.ts` — SSR compilation, hydration preprocessing, client bundling.
- `packages/mochi/src/hooks.ts` — middleware system (`Handle`, `sequence()`).
- `packages/mochi/src/utils.ts` — `json()`, `error()`, header helpers.
- `packages/mochi/src/middleware/compress.ts` — optional `compress()` middleware (brotli + gzip negotiation).
- `packages/mochi/src/middleware/noCache.ts` — optional `noCache` middleware that defaults `Cache-Control: no-cache`.
- `packages/mochi/src/web-components/HydratableIsland.ts` — client-side custom element for island hydration.
- `packages/mochi/src/web-components/ServerIsland.ts` — client-side custom element for server island fetching.
- `packages/mochi/src/serverIslandCrypto.ts` — HMAC signing/verification for server island props.
- `packages/mochi/src/types.ts` — shared TypeScript types.
