---
title: 'Why Bun?'
slug: why-bun
---

## Why Bun?

Mochi targets the [Bun](https://bun.sh/) runtime. The framework leans on Bun's standard library instead of pulling in a bundler, file API, server, glob, hash, and compression as separate dependencies. Mochi will not run on plain Node.

### What Mochi uses Bun for

- `Bun.serve()` — backs the HTTP and WebSocket server in `Mochi.serve()`.
- `Bun.build()` and `Bun.Transpiler` — bundle client islands and transpile `.ts` / `.svelte` on demand during SSR.
- `Bun.file()` and `Bun.write()` — read the HTML shell and component sources, write built assets, serve static files.
- `Bun.Glob` — discovers routes, docs, and raw CSS files.
- `Bun.hash` — generates content-hashed filenames for cache-busted bundles and CSS.
- `Bun.gzipSync` and `Bun.deflateSync` / `Bun.inflateSync` — compress HTTP responses and pack signed server-island prop payloads into URLs.
- `Bun.resolveSync` — resolves `devalue` and `mitt` injected into generated client code.
- Native `.ts` execution and auto-loaded `.env` — sources run directly under `bun run`.

### Rules for app code

- Use `Bun.serve` for HTTP, `bun:sqlite` for SQLite, `Bun.file` for filesystem reads.
- Do **NOT** add `dotenv`; instead, rely on Bun's built-in `.env` loading.
- Do **NOT** add `ts-node` or a separate transpile step; instead, run `.ts` files with `bun run`.
- Do **NOT** install `express` or `better-sqlite3`; instead, use the Bun built-ins above.
