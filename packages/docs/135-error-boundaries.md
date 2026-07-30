---
title: 'Error boundaries'
slug: error-boundaries
description: 'Hydratable islands are auto-wrapped in svelte:boundary, so one island failure cannot crash the page.'
---

<script>
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Error boundaries

Mochi auto-wraps every `mochi:hydrate` and `mochi:hydrate:visible` island in `<svelte:boundary>`. A throw inside one island no longer takes down the page render. Mochi replaces the failed island with a `<mochi-island-failure>` stub, and the rest of the page continues. No opt-in, no configuration.

### What is wrapped

- `mochi:hydrate` — wrapped.
- `mochi:hydrate:visible` — wrapped.
- `mochi:defer` — handled by the server-island endpoint, not by a boundary.
- Top-level page render throws — go to the configured `errorPage`. See [Error handling](/docs/error-handling/).

### What gets caught

- Synchronous SSR throws inside the island.
- Async SSR throws (`await Promise.reject(...)` in a top-level `<script>`).
- Client-side throws after hydration (`$effect`, `$derived`, synchronous script throws), caught through `transformError` on `hydrate()`.
- Synchronous failures in the island's bundle import or in `hydrate()` itself, caught by a defensive try/catch and rendered as the same stub.

A client-side throw logs to the browser console but does **not** emit `island:error`. The event bus is server-side only.

### Visual behavior

In development, Mochi replaces the failed island with a dashed-red `<mochi-island-failure>` marker showing the component name and error message. In production, the element is hidden with `display: none`, so users see a clean gap.

### Server islands (`mochi:defer`)

The `/island/:name` endpoint try/catches the SSR render and returns `200` plus a `<mochi-island-failure>` stub. The `200` is intentional — a `5xx` would trigger the client's retry loop against a deterministic failure. Your fallback children stay visible until the response arrives.

### Author your own boundary

Mochi passes `transformError` to `render()` and `hydrate()`, which makes `<svelte:boundary>` functional during SSR. Use `<svelte:boundary>` anywhere for bespoke degradation:

```svelte
<!-- file: src/SomePage.svelte -->
{#snippet failed(error: Error)}
  <p>Something went wrong: {error.message}</p>
{/snippet}

<svelte:boundary {failed}>
  <SomePieceThatMightThrow />
</svelte:boundary>
```

### `island:error` event

Every server-side island failure emits `island:error` on `mochiEvents`. Subscribe to forward failures to error tracking:

```ts
// file: src/index.ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.on('island:error', ({ componentName, kind, message, stack }) => {
  tracker.capture(message, { componentName, kind, stack });
});
```

| Field           | Description                                                                               |
| --------------- | ----------------------------------------------------------------------------------------- |
| `componentName` | Island component name.                                                                    |
| `islandId`      | Per-island id from the encrypted props envelope; set for `'server'`, else `undefined`.    |
| `kind`          | `'hydratable'` (SSR throw in a hydratable island) or `'server'` (server-island render).   |
| `message`       | Error message, safe to forward.                                                           |
| `stack`         | Stack trace, populated only when `development: true`.                                     |

`MochiIslandErrorKind` also reserves `'client-hydrate'`, but client-side errors are not currently emitted to the event bus.

### See also

- [Error handling](/docs/error-handling/) — top-level page errors and the configured `errorPage`.
- [Selective hydration](/docs/selective-hydration/), [Lazy hydration](/docs/lazy-hydration/), [Server islands](/docs/server-islands/) — the directives boundaries wrap.

<SeeItInAction
demos={[{ href: "/demos/error-boundaries/", title: "Error Boundaries", hook: "Contain island failures so one broken component does not crash the page." }]}
/>
