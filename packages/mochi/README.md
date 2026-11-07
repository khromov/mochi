# Mochi

An SSR framework for [Svelte 5](https://svelte.dev/) on [Bun](https://bun.sh/) with islands-based selective hydration. Components render server-side on every request; only those marked `mochi:hydrate` (or `mochi:hydrate:visible` / `mochi:defer`) ship JavaScript to the browser.

> **Work in progress.** Mochi is a new framework and we're still working on features. Be one of the first ones to try it and report any issues you find!

## Install

```sh
bun create mochi@latest        # scaffold a new project
# or
bun add mochi-framework        # add to an existing Bun project
```

Mochi runs on Bun. Node.js is not supported.

## Minimal example

```ts
// src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  port: 3000,
  routes: {
    '/': Mochi.page('./src/App.svelte'),
  },
});
```

```svelte
<!-- src/App.svelte --><h1>Hello Mochi</h1>
```

```sh
bun run src/index.ts
```

## Docs

Full documentation lives at [`packages/docs/`](https://github.com/khromov/mochi/tree/main/packages/docs) — intro, routes, selective hydration, server islands, forms, middleware, caching, events, and more. Served at `/docs/<section>` when you run the demo site (`bun run dev` in the monorepo).

## License

MIT
