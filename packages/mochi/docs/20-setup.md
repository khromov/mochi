---
title: 'Setup'
slug: setup
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Setup

Mochi runs on [Bun](https://bun.sh/). Install dependencies, then start the dev server:

1. Install dependencies with `bun install`.
2. Run `bun run dev` for development mode (live reload).
3. Run `bun run start` for production mode.

```sh
bun install
bun run dev
bun run start
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
