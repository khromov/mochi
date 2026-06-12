---
title: 'Selective hydration with mochi:hydrate'
slug: selective-hydration
description: 'Mark components with mochi:hydrate to ship client-side JavaScript only where interactivity is needed.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Selective hydration with `mochi:hydrate`

Components render server-side by default and ship zero JavaScript. Add `mochi:hydrate` to opt a component into client-side hydration; everything else stays static HTML.

```svelte
<!-- file: src/routes/Page.svelte -->
<Counter mochi:hydrate count={5} />
<StaticHeader />
```

Props are serialized with `devalue` and embedded into the HTML so the same values are available during hydration. See `Passing props to islands` for the supported types.

Do **NOT** nest `mochi:hydrate` (or `mochi:hydrate:visible`) inside another hydratable component; instead, remove the inner directive and let the outer island hydrate the whole subtree. Hydration is all-or-nothing per island — the framework rejects nested directives at compile time.

### `islandId` and `isHydratable` props

Every island invocation receives two implicit props from the framework:

- `islandId` — string matching the wrapper's `island-id` attribute, available on `mochi:hydrate`, `mochi:hydrate:visible`, and `mochi:defer`.
- `isHydratable` — `true` when the call site uses `mochi:hydrate`, `mochi:hydrate:visible`, `mochi:clientOnly`, or `mochi:defer mochi:hydrate`. Undefined for pure SSR-only invocations.

Accept them in the component's `$props()` to branch on hydration state at the same call site that opts in:

```svelte
<!-- file: src/lib/Counter.svelte -->
<script lang="ts">
  let {
    islandId,
    isHydratable,
    count = 0,
  } = $props<{
    islandId?: string;
    isHydratable?: boolean;
    count?: number;
  }>();
</script>

{#if isHydratable}
  <button onclick={() => count++}>{count}</button>
{:else}
  <span>{count}</span>
{/if}
```

Do **NOT** declare `islandId` or `isHydratable` as user-controlled props; instead, treat them as read-only inputs from the framework.

### `mochi:hydrate:visible`

Use `mochi:hydrate:visible` to defer hydration until the component scrolls into view. The component still server-renders; only its JS (and CSS) load on first intersection.

```svelte
<HeavyChart mochi:hydrate:visible />
<HeavyChart mochi:hydrate:visible={{ rootMargin: '200px' }} />
```

Pass `rootMargin` to start loading before the component enters the viewport. See `Lazy hydration with mochi:hydrate:visible` for the full options.

<Callout type="warning">

Islands that use `:visible` require JS to apply their styles — per-component CSS is loaded alongside the bundle on intersection, not in the initial page `<head>`. If you need the island to look correcft on initial SSR load, do not use `:visible`.

</Callout>

### `mochi:clientOnly`

Use `mochi:clientOnly` to skip SSR entirely — the component is mounted in the browser only, with an optional fallback snippet as the SSR placeholder. See `Client-only components with mochi:clientOnly`.

```svelte
<!-- Never server-rendered; mounts in the browser -->
<AudioVisualizer mochi:clientOnly />
```

### `mochi:defer`

Use `mochi:defer` to render the component on a separate request after the page ships, and combine it with `mochi:hydrate` to also hydrate the deferred markup once it lands. See `Server islands with mochi:defer` for the full lifecycle.

```svelte
<!-- Server-rendered after page load, then hydrated -->
<ShoppingCart mochi:defer mochi:hydrate items={initialItems} />
```
