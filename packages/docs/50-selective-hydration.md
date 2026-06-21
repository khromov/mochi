---
title: 'Selective hydration with mochi:hydrate'
slug: selective-hydration
description: 'Mark components with mochi:hydrate to ship client-side JavaScript only where interactivity is needed.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Selective hydration with `mochi:hydrate`

Components render server-side by default and ship zero JavaScript. Add `mochi:hydrate` to opt a component into client-side hydration; everything else stays static HTML.

```svelte
<!-- file: src/routes/Page.svelte -->
<Counter mochi:hydrate count={5} />
<StaticHeader />
```

Props are serialized with `devalue` into a `<script type="application/json">` block emitted just before the island, so the same values are available during hydration. See `Passing props to islands` for the supported types.

<Callout type="info">

**Hydration is all-or-nothing per island.** A `mochi:hydrate` (or `mochi:hydrate:visible`) directive hydrates the whole subtree, so nesting one inside another hydratable component is rejected at compile time. Mark the outermost component and let it cover everything below it.

</Callout>

### The `isHydratable` prop

Every island invocation receives one implicit prop from the framework:

- `isHydratable` — `true` when the call site uses `mochi:hydrate`, `mochi:hydrate:visible`, or `mochi:defer mochi:hydrate`. Undefined for pure SSR-only invocations.

Accept it in the component's `$props()` to branch on hydration state at the same call site that opts in:

```svelte
<!-- file: src/lib/Counter.svelte -->
<script lang="ts">
  let {
    isHydratable,
    count = 0,
  }: {
    isHydratable?: boolean;
    count?: number;
  } = $props();
</script>

{#if isHydratable}
  <button onclick={() => count++}>{count}</button>
{:else}
  <span>{count}</span>
{/if}
```

### Unique ids with `$props.id()`

For a unique, SSR-stable id inside an island, use Svelte's native [`$props.id()`](<https://svelte.dev/docs/svelte/$props#$props.id()>) — the value generated during the server render is reused on hydration:

```svelte
<!-- file: src/lib/SignupField.svelte -->
<script lang="ts">
  const uid = $props.id();
</script>

<label for="{uid}-email">Email</label>
<input id="{uid}-email" type="email" />
```

Each component instance gets its own id, so repeating the same island on a page never produces duplicate DOM ids. It also works inside server islands: their standalone renders are namespaced with the island id carried inside the signed props envelope (via render's `idPrefix`), so ids from a deferred fragment cannot collide with ids already on the page.

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

### `mochi:defer`

Use `mochi:defer` to render the component on a separate request after the page ships, and combine it with `mochi:hydrate` to also hydrate the deferred markup once it lands. See `Server islands with mochi:defer` for the full lifecycle.

```svelte
<!-- Server-rendered after page load, then hydrated -->
<ShoppingCart mochi:defer mochi:hydrate items={initialItems} />
```

<SeeItInAction
  demos={[
    { href: "/demos/hydration/", title: "Hydration Modes", hook: "The same component rendered five ways — eager, lazy, visible, rootMargin-tuned, and deferred server island." },
    { href: "/demos/lazy/", title: "Lazy Islands", hook: "Islands marked mochi:hydrate:visible hydrate and load their CSS only when scrolled into view." },
    { href: "/demos/server-island/", title: "Server Islands", hook: "Components marked mochi:defer render server-side on demand after the initial page is delivered." },
  ]}
/>
