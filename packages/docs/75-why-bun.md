---
title: 'Why Bun?'
slug: why-bun
description: 'Why Mochi chose Bun as its runtime and which Bun APIs the framework uses.'
---

<script>
  import ComparisonTable from './_components/ComparisonTable.svelte';
</script>

## Why Bun?

Mochi delegates subsystem complexity to the Bun runtime. Instead of maintaining a bundler, an HTML parser, a router, database drivers, compression, and hashing as separate packages, Mochi calls Bun's standard library. Bun maintains those components. Mochi calls them.

Mochi ships about 10 runtime dependencies. It uses an external dependency when the dependency earns its place and improves the developer experience. The goal is an opinionated, batteries-included toolkit for building complex web apps.

### What Mochi uses from Bun

- `Bun.build()` and `Bun.Transpiler` — Mochi's bundler.
- `Bun.plugin()` — backs the virtual `mochi` module (`isServer`, `isBrowser`, `isDev`) injected at build time.
- `HTMLRewriter` — island discovery and HTML rewriting.
- `Bun.serve()` — the HTTP and WebSocket server in `Mochi.serve()`.
- `Bun.Glob` — discovers routes, docs, and raw CSS files.
- `Bun.deflateSync` / `Bun.inflateSync` — packs encrypted server-island prop payloads into URLs.
- `bun:sqlite` and `bun:sql` — zero-dependency SQLite and PostgreSQL for app data.
- `bun:test` — runs Mochi's own test suite with per-file process isolation.
- Native `.ts` execution and auto-loaded `.env` — TypeScript runs directly under `bun run`.

### Batteries included

Building on Bun's standard library lets Mochi ship this much out of the box. Here is how the surface compares to SvelteKit:

<ComparisonTable mochi:hydrate />

### On the horizon

As Bun adds features, Mochi gains new abilities. For example, `Bun.Image()` powers on-the-fly image resizing.
