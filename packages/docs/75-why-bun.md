---
title: 'Why Bun?'
slug: why-bun
description: 'Why Mochi chose Bun as its runtime and which Bun APIs the framework relies on.'
---

## Why Bun?

Mochi was built to be performant and simple. We do this by "outsourcing" subsystem complexity to the Bun runtime. Instead of writing or managing a bundler, an HTML parser, a router, database drivers, compression, and hashing as separate npm packages, the framework delegates to Bun's standard library. Bun maintains those components; Mochi just calls them.

The result: a full-featured SSR framework with just ~15 runtime dependencies. This isn't about minimizing dependencies for the sake of it — external deps are fine when they earn their place. The point is to use Buns extensive standard library and provide a toolkit that makes it possible to build complex web apps with just a few well-chosen dependencies.

### The hard-to-replace APIs

Two Bun APIs that would require significant external packages to replicate:

**`Bun.build()` / `Bun.Transpiler`** — Mochi's bundler. Bundles client islands and transpiles `.ts` / `.svelte` on demand during SSR. Without Bun you'd pull in Vite, Rolldown, or esbuild.

**`HTMLRewriter`** — Bun ships Cloudflare's lol-html as a built-in global. Mochi uses it for:

- **Islands discovery** — after SSR, scans the output HTML to find which `<mochi-hydratable-island>` and `<mochi-server-island>` elements were actually rendered, so only their JS/CSS ships to the client.
- **Hydration marker stripping** — removes Svelte SSR comment markers from page-level HTML while preserving them inside island boundaries where hydration needs them.

Without it you'd need `htmlparser2`, `cheerio`, or similar.

### Everything else

Convenient APIs that could individually be replaced with npm packages or Node built-ins, but together they keep the dep tree flat:

- `Bun.serve()` — backs the HTTP and WebSocket server in `Mochi.serve()`.
- `Bun.file()` and `Bun.write()` — read the HTML shell and component sources, write built assets, serve static files.
- `Bun.Glob` — discovers routes, docs, and raw CSS files.
- `Bun.hash` — generates content-hashed filenames for cache-busted bundles and CSS.
- `Bun.gzipSync` and `Bun.deflateSync` / `Bun.inflateSync` — compress HTTP responses and pack signed server-island prop payloads into URLs.
- `Bun.resolveSync` — resolves `devalue` and `mitt` injected into generated client code.
- `bun:sqlite` — zero-dep SQLite for app data.
- Native `.ts` execution and auto-loaded `.env` — sources run directly under `bun run`.

### On the horizon

`Bun.Image()` — on-the-fly image resizing (like `next/image` without pulling in `sharp`). Same pattern: use the runtime, skip the dep.