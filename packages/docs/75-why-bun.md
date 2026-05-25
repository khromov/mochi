---
title: 'Why Bun?'
slug: why-bun
description: 'Why Mochi chose Bun as its runtime and which Bun APIs the framework relies on.'
---

## Why Bun?

Mochi was built to be performant and simple. We do this by "outsourcing" subsystem complexity to the Bun runtime. Instead of writing or managing a bundler, an HTML parser, a router, database drivers, compression, and hashing as separate npm packages, the framework delegates to Bun's standard library. Bun maintains those components; Mochi just calls them.

The result: a full-featured SSR framework with just ~15 runtime dependencies. This isn't about minimizing dependencies for the sake of it — external deps are fine when they earn their place. The point is to use Buns extensive standard library and provide a toolkit that makes it possible to build complex web apps with just a few well-chosen dependencies.

### What does Mochi actually use from Bun?

- `Bun.build()` and `Bun.Transpiler` — Mochi's bundler. Replaces Vite and other build tools.
- `HTMLRewriter` — Mochi uses it for islands discovery and HTML rewriting. Replaces `htmlparser2`, `cheerio`, and similar libraries.
- `Bun.serve()` — backs the HTTP and WebSocket server in `Mochi.serve()`. Replaces `express`, `fastify`, or `hono`.
- `Bun.Glob` — discovers routes, docs, and raw CSS files. Replaces `fast-glob` or `globby`.
- `Bun.gzipSync` and `Bun.deflateSync` / `Bun.inflateSync` — compress HTTP responses and pack signed server-island prop payloads into URLs. Replaces `node:zlib`.
- `bun:sqlite` and `bun:sql` — zero-dep SQLite and PostgreSQL for app data. Replaces `better-sqlite3` and `pg`.
- Native `.ts` execution and auto-loaded `.env` — TypeScript runs directly under `bun run`. Replaces `ts-node` and `dotenv`.

### On the horizon

As Bun gets new features, we get new abilities to extend Mochi — for example `Bun.Image()` for on-the-fly image resizing (like `next/image` without pulling in `sharp`).
