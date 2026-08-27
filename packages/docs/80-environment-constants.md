---
title: 'Environment constants'
slug: environment-constants
description: 'Constants for branching on render target (isServer, isBrowser), dev mode (isDev), and the build itself (isBuilding).'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Environment constants

Import these from `mochi-framework` to branch on render target or dev mode:

```ts
import { isServer, isBrowser, isDev } from 'mochi-framework';
```

Inside compiled code — `.svelte`, `.svelte.[jt]s`, and any `.ts` they import — Mochi substitutes a per-bundle module, so each constant is a literal boolean fixed when that bundle is built. In the server build `isServer` is `true` and `isBrowser` is `false`; in the client bundle the values are reversed.

Everywhere else — `src/index.ts`, `routes.ts`, a `.server.ts` reached from them — they are ordinary exports of the package, read at runtime.

<Callout type="warning">

**These do not keep code out of the client bundle.** The constant is a literal, but Bun does not fold it across module boundaries, so the untaken branch is still bundled — it just never runs. To keep a server-only implementation out of the browser entirely, put it in a [`.server.ts` file](/docs/server-only-imports/), which Mochi replaces with a throwing stub in the client build.

</Callout>

### `isServer`

`true` during server-side rendering, `false` in the browser.

```svelte
<!-- file: src/lib/HeavyChart.svelte -->
<script>
  import { isServer } from 'mochi-framework';

  if (isServer) {
    // reach into request-scoped APIs here
  }
</script>
```

### `isBrowser`

`true` in the client bundle, `false` on the server. Use it to gate browser-only APIs (`window`, `document`, `IntersectionObserver`).

```svelte
<!-- file: src/lib/Lazy.svelte -->
<script>
  import { isBrowser } from 'mochi-framework';

  if (isBrowser) {
    window.addEventListener('scroll', onScroll);
  }
</script>
```

### `isDev`

`true` when `Mochi.serve()` started with `development: true`. Identical on server and client builds.

```ts
// file: src/lib/log.ts
import { isDev } from 'mochi-framework';

export function trace(msg: string) {
  if (isDev) console.log('[trace]', msg);
}
```

#### Reads that run before `Mochi.serve()`

In a server entry, `isDev` is a live value rather than a baked literal, and `Mochi.serve()` is what sets it. Your entry imports its routes — and through them any `.server.ts` — before it awaits `serve()`, so every module top-level statement runs first.

Until then `isDev` falls back to the environment: `true` when `NODE_ENV=development`, `false` otherwise. Keep `NODE_ENV=development` in your `dev` script and unset in production and the two always agree:

```json
// file: package.json
{
  "scripts": {
    "dev": "NODE_ENV=development bun src/index.ts",
    "start": "bun src/index.ts"
  }
}
```

Passing `development: true` without setting `NODE_ENV` means a top-level `if (isDev)` reads `false` while the server runs in dev. Reads inside a handler, an action, or `serverProps` happen after boot and always see the resolved value:

```ts
// file: src/db.server.ts
import { isDev } from 'mochi-framework';

const seeded = isDev; // module top level — the env fallback
export const usingFixtures = () => isDev; // called per request — the resolved value
```

Mochi warns at boot if `NODE_ENV=development` is set but the server started with `development: false`, since dev-only top-level branches will already have run in a production process.

### `isBuilding`

`true` only while `mochi-framework build` runs your `index.ts`, `false` when serving (dev or prod). `mochi-framework build` executes your entry to capture its `Mochi.serve()` options, so top-level side effects in `index.ts` run at build time too. Gate the ones you don't want then — connecting a database, spawning workers, running migrations:

```ts
// file: src/index.ts
import { Mochi, isBuilding } from 'mochi-framework';

if (!isBuilding) await db.connect();

await Mochi.serve({ routes });
```

The dev server re-imports `index.ts` on every rebuild to pick up route changes; that import sees `true` too, so gated side effects don't re-run on each save.

Inside `.svelte` components it is always `false` — components are compiled but never executed during a build.

## Detecting hydration with `isHydratable()`

To branch on whether the client will take over rendering, use `isHydratable()`: it returns `true` when the calling component — at any nesting depth — belongs to a subtree that will hydrate on this page load. Unlike the constants above it is a runtime signal, not a build-time literal, so it lives with the hydration model rather than here. See [Selective hydration](/docs/selective-hydration/#ishydratable) for the full semantics and an example.

<SeeItInAction
demos={[{ href: "/demos/url/", title: "Isomorphic URL", hook: "How the isomorphic URL helper works — one import that reads the request URL on the server and window.location on the client." }]}
/>
