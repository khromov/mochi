---
title: 'Error boundaries'
slug: error-boundaries
description: 'Hydratable islands are automatically wrapped in svelte:boundary so a single island failure cannot crash the page.'
---

<script>
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Error boundaries

Mochi auto-wraps every `mochi:hydrate` and `mochi:hydrate:visible` island in `<svelte:boundary>`. A throw inside one island no longer takes down the page render — the failed island is replaced by a `<mochi-island-failure>` stub and the rest of the page continues. No opt-in, no configuration.

### What's wrapped

- `mochi:hydrate` — wrapped.
- `mochi:hydrate:visible` — wrapped.
- `mochi:defer` — handled by the server-island endpoint instead, not by a boundary.
- Top-level page render throws — go to the configured `errorPage`. See `Error handling`.

### What gets caught

- Synchronous SSR throws inside the island.
- Async SSR throws (`await Promise.reject(...)` in a top-level `<script>`).
- Client-side throws after hydration (`$effect`, `$derived`, synchronous script throws) — caught via `transformError` on `hydrate()`.
- Synchronous failures in the island's bundle import or in `hydrate()` itself — caught by a defensive try/catch and rendered as the same stub.

Client-side throws log to the browser console but do **NOT** emit `island:error`; the event bus is server-side only.

### Visual behaviour

In development the failed island is replaced by a dashed-red `<mochi-island-failure>` marker showing the component name and error message. In production the element is hidden via `display: none`, so end users see a clean gap instead of a stack trace.

### Server islands (`mochi:defer`)

The `/island/:name` endpoint try/catches the SSR render and returns `200` plus a `<mochi-island-failure>` stub. The `200` is intentional — a `5xx` would trigger the client's retry loop against a deterministic failure. Whatever fallback children you passed stay visible until the response arrives.

### Author your own boundary

Mochi passes `transformError` to `render()` and `hydrate()`, which is what makes `<svelte:boundary>` functional during SSR (stock Svelte boundaries are no-ops on the server without it). Use `<svelte:boundary>` anywhere — wrap a non-island component, or wrap a chunk of a page when you want bespoke degradation:

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

| Field           | Description                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `componentName` | Island component name.                                                                                                   |
| `islandId`      | Per-island id, carried inside the encrypted props envelope; set for `'server'` failures, `undefined` for `'hydratable'`. |
| `kind`          | `'hydratable'` (SSR throw inside a hydratable island) or `'server'` (server-island endpoint render).                     |
| `message`       | Error message — safe to forward.                                                                                         |
| `stack`         | Stack trace; populated only when `development: true`.                                                                    |

The `MochiIslandErrorKind` type also reserves `'client-hydrate'`, but client-side errors are not currently emitted to the event bus.

### See also

- [Error handling](/docs/error-handling/) — top-level page errors and the configured `errorPage`.
- [Selective hydration](/docs/selective-hydration/), [Lazy hydration](/docs/lazy-hydration/), [Server islands](/docs/server-islands/) — the directives boundaries wrap.

<SeeItInAction
demos={[{ href: "/demos/error-boundaries/", title: "Error Boundaries", hook: "Contain island failures with <svelte:boundary> so one broken component does not crash the page." }]}
/>
