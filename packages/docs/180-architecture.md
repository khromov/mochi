---
title: 'Architecture'
slug: architecture
description: 'Overview of the framework directory structure and key source files.'
---

## Architecture

Framework source lives in `packages/mochi/src/`. The demo site that consumes it lives in `packages/site/src/`. The files you reach for most often:

- `packages/site/src/index.ts` — HTTP server entry point; calls `Mochi.serve()` and defines the demo site's routes inline.
- `packages/mochi/src/Mochi.ts` — `Mochi.serve()`, `Mochi.page()`, `Mochi.api()`, `Mochi.ws()`, `Mochi.sse()`.
- `packages/mochi/src/compiler/ComponentRegistry.ts` — SSR compilation, hydration preprocessing, client bundling.
- `packages/mochi/src/runtime/hooks.ts` — the middleware system (`Handle`, `sequence()`).
- `packages/mochi/src/utils/index.ts` — `json()`, `error()`, header helpers.
- `packages/mochi/src/middleware/compress.ts` — the optional `compress()` middleware.
- `packages/mochi/src/middleware/noCache.ts` — the optional `noCache` middleware.
- `packages/mochi/src/web-components/HydratableIsland.ts` — client-side custom element for island hydration.
- `packages/mochi/src/web-components/ServerIsland.ts` — client-side custom element for server-island fetching.
- `packages/mochi/src/islands/serverIslandCrypto.ts` — authenticated encryption for server-island props (AES-256-SIV / RFC 5297 from `@noble/ciphers`).
- `packages/mochi/src/types.ts` — shared TypeScript types.
