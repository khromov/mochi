---
title: 'Why Bun?'
slug: why-bun
description: 'Why Mochi chose Bun as its runtime and which Bun APIs the framework relies on.'
---

<script>
  import ComparisonTable from './_components/ComparisonTable.svelte';
</script>

## Why Bun?

Mochi was built to be performant and simple. We do this by "outsourcing" subsystem complexity to the Bun runtime. Instead of writing or managing a bundler, an HTML parser, a router, database drivers, compression, and hashing as separate npm packages, the framework delegates to Bun's standard library. Bun maintains those components; Mochi just calls them.

Mochi is backed by just ~10 runtime dependencies. We don't minimize dependencies for the sake of it — external depenendencies are fine when they earn their place and genuinely improve the developer experience. The point is to use Buns extensive standard library and provide an opinionated toolkit that makes it possible to build complex web apps with "batteries included" out of the box.

### What does Mochi actually use from Bun?

- `Bun.build()` and `Bun.Transpiler` — Mochi's bundler. Replaces Vite and other build tools.
- `Bun.plugin()` — backs the virtual `mochi` module (`isServer`, `isBrowser`, `isDev`) injected at build time. Replaces `@rollup/plugin-virtual` or a custom esbuild plugin.
- `HTMLRewriter` — Mochi uses it for islands discovery and HTML rewriting. Replaces `htmlparser2`, `cheerio`, and similar libraries.
- `Bun.serve()` — backs the HTTP and WebSocket server in `Mochi.serve()`. Replaces `express`, `fastify`, or `hono`.
- `Bun.Glob` — discovers routes, docs, and raw CSS files. Replaces `fast-glob` or `globby`.
- `Bun.deflateSync` / `Bun.inflateSync` — pack signed server-island prop payloads into URLs. Replaces `node:zlib`.
- `bun:sqlite` and `bun:sql` — zero-dep SQLite and PostgreSQL for app data. Replaces `better-sqlite3` and `pg`.
- `bun:test` — runs Mochi's own test suite, with per-file process isolation. Replaces Vitest or Jest.
- Native `.ts` execution and auto-loaded `.env` — TypeScript runs directly under `bun run`. Replaces `ts-node` and `dotenv`.

### Batteries included

Leaning on Bun's standard library is what lets Mochi ship so much out of the box. Here's how that batteries-included surface compares to SvelteKit:

<ComparisonTable mochi:hydrate />

### On the horizon

As Bun gets new features, we get new abilities to extend Mochi — for example `Bun.Image()` for on-the-fly image resizing (like `next/image` without pulling in `sharp`).
