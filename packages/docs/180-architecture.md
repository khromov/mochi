---
title: 'Architecture'
slug: architecture
description: 'Overview of the framework directory structure and key source files.'
---

## Architecture

Framework source lives in `packages/mochi/src/`; the demo site that consumes it lives in `packages/site/src/`. The files you reach for most often:

- `packages/site/src/index.ts` — HTTP server entry point; calls `Mochi.serve()` and defines the demo site's route record inline.
- `packages/mochi/src/Mochi.ts` — `Mochi.serve()`, `Mochi.page()`, `Mochi.api()`, `Mochi.ws()`, `Mochi.sse()`.
- `packages/mochi/src/ComponentRegistry.ts` — SSR compilation, hydration preprocessing, client bundling.
- `packages/mochi/src/hooks.ts` — middleware system (`Handle`, `sequence()`).
- `packages/mochi/src/utils.ts` — `json()`, `error()`, header helpers.
- `packages/mochi/src/middleware/compress.ts` — optional `compress()` middleware (brotli + gzip negotiation).
- `packages/mochi/src/middleware/noCache.ts` — optional `noCache` middleware that defaults `Cache-Control: no-cache`.
- `packages/mochi/src/web-components/HydratableIsland.ts` — client-side custom element for island hydration.
- `packages/mochi/src/web-components/ServerIsland.ts` — client-side custom element for server island fetching.
- `packages/mochi/src/serverIslandCrypto.ts` — authenticated encryption/decryption for server island props (via the shared `payloadCrypto.ts`, AES-256-SIV / RFC 5297 from `@noble/ciphers`).
- `packages/mochi/src/types.ts` — shared TypeScript types.
