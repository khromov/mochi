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

`true` in [development mode](/docs/development-mode/), which is `NODE_ENV=development`. Identical on server and client builds.

```ts
// file: src/lib/log.ts
import { isDev } from 'mochi-framework';

export function trace(msg: string) {
  if (isDev) console.log('[trace]', msg);
}
```

Because it comes from the environment, `isDev` is correct from the first line of your entry — including in module top-level code, which runs before `Mochi.serve()` does.

```json
// file: package.json
{
  "scripts": {
    "dev": "NODE_ENV=development bun src/index.ts",
    "start": "bun src/index.ts"
  }
}
```

Overriding the mode with `Mochi.serve({ development })` is the one way to make them disagree: top-level code has already run by then, so it saw the environment's answer, not your override. Mochi warns at boot when an override contradicts `NODE_ENV=development`, since dev-only top-level branches will have run inside a production process.

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
