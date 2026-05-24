---
title: 'Setup'
slug: setup
description: 'Install Bun, scaffold a project, and start the dev server.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Setup

Mochi runs on [Bun](https://bun.sh/). Install dependencies, then start the dev server:

1. Install dependencies with `bun install`.
2. Add a `bunfig.toml` with the Mochi plugin preload (enables Svelte component imports in route files).
3. Run `bun run dev` for development mode (live reload).
4. Run `bun run start` for production mode.

```sh
bun install
bun run dev
bun run start
```

### `bunfig.toml`

Create a `bunfig.toml` in your project root with the Mochi plugin preload. This lets you import `.svelte` components directly in route files and pass them to `Mochi.page()`:

```toml
[run]
preload = ["mochi-framework/plugin"]
```

Do **NOT** use `npm` or `pnpm` to install; instead, use `bun install` so the lockfile stays consistent and Bun-only APIs (`bun:sqlite`, `Bun.file`) resolve.

<Callout type="warning">

**Current limitations.** The framework is an early prototype. Known gaps:

There are many things that aren't implemented yet. You'll find a non-exhaustive list below:

- HMR always does full page reloads
- No SCSS/SASS support
- No HTTP streaming (see <a href="/docs/http-streaming/">this page</a> for why you probably don't need it)

Hit something rough? Ask in the <a href="https://discord.com/invite/QCGfks4gg8" target="_blank" rel="noopener noreferrer">Mochi Discord</a> — the framework is moving fast and someone has likely already worked around it.

</Callout>
