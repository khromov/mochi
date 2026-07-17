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

### What is an island?

**An island is any component you mark with a `mochi:*` directive** — `mochi:hydrate`, `mochi:hydrate:visible`, `mochi:clientOnly`, `mochi:clientOnly:visible`, `mochi:defer`, or `mochi:defer:visible`. Everything else is plain server-rendered HTML that ships no JavaScript. Each island is compiled and shipped in isolation: the directive family decides _when_ and _where_ it runs — hydrate in place, mount client-only, or fetch on-demand as a [server island](/docs/server-islands/) — but in every case except the pure server-side `mochi:defer` variants, an island is the unit that gets its own client bundle.

### Supported import forms

An island must be statically imported from a **relative** `.svelte` / `.md` / `.svx` path in the same file's `<script>`. Default, named, and mixed imports all work:

```svelte
<script>
  import Counter from './Counter.svelte'; // default
  import { Widget } from './Barrel.svelte'; // named (module-script export)
  import Chart, { presets } from './Chart.svelte'; // mixed
</script>

<Counter mochi:hydrate />
<Widget mochi:hydrate />
<Chart mochi:hydrate:visible />
```

The framework's own components from `mochi-framework/components` are the one package exception — a directive sits directly on the package import, no wrapper and no extension:

```svelte
<script>
  import { MochiCaptcha } from 'mochi-framework/components';
</script>

<MochiCaptcha mochi:hydrate />
```

Anything else is a **compile error** — surfaced on the dev error page and failing `mochi-framework build`:

- **Third-party package imports** (`import { Widget } from 'some-ui-lib'`) — wrap the component in a local `.svelte` file and put the directive on the wrapper instead.
- **Components received via props, variables, or namespaces** (`<Item.Row mochi:hydrate />`) — an island needs a statically known source file; same wrapper fix.

```svelte
<!-- file: src/lib/Wrapped.svelte — local wrapper makes a third-party component an island -->
<script>
  import { Widget } from 'some-ui-lib';
  let props = $props();
</script>

<Widget {...props} />
```

```svelte
<script>
  import Wrapped from './Wrapped.svelte';
</script>

<Wrapped mochi:hydrate />
```

These rules apply to every directive family: `mochi:hydrate*`, `mochi:defer*`, and `mochi:clientOnly*`.

<Callout type="info">

**Hydration is all-or-nothing per island.** A `mochi:hydrate` (or `mochi:hydrate:visible`) directive hydrates the whole subtree, so nesting one inside another hydratable component is rejected at compile time. Mark the outermost component and let it cover everything below it.

</Callout>

### The `isHydratable` prop

Every island invocation receives one implicit prop from the framework:

- `isHydratable` — `true` when the call site uses `mochi:hydrate`, `mochi:hydrate:visible`, `mochi:clientOnly`, `mochi:clientOnly:visible`, or `mochi:defer mochi:hydrate`. Undefined for pure SSR-only invocations. For `mochi:clientOnly*` islands it is always `true` (they never server-render, so the component only ever runs at client mount).

`mochi:hydrate*` and `mochi:clientOnly*` islands receive no `islandId` prop — for a unique id, use Svelte's `$props.id()`. Server islands (`mochi:defer`) are the exception: they carry an `islandId` inside their encrypted props envelope as the render's `idPrefix`.

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

Each component instance gets its own id, so repeating the same island on a page never produces duplicate DOM ids. It also works inside server islands: their standalone renders are namespaced with the island id carried inside the encrypted props envelope (via render's `idPrefix`), so ids from a deferred fragment cannot collide with ids already on the page.

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

Add `:visible` to defer the browser mount until the placeholder scrolls into view, with the same `rootMargin` option:

```svelte
<!-- Never server-rendered; mounts when scrolled into view -->
<AudioVisualizer mochi:clientOnly:visible={{ rootMargin: '200px' }} />
```

### `mochi:defer`

Use `mochi:defer` to render the component on a separate request after the page ships, and combine it with `mochi:hydrate` to also hydrate the deferred markup once it lands. See `Server islands with mochi:defer` for the full lifecycle.

```svelte
<!-- Server-rendered after page load, then hydrated -->
<ShoppingCart mochi:defer mochi:hydrate items={initialItems} />
```

Add `:visible` to defer the fetch until the placeholder scrolls into view, with the same `rootMargin` option (and combinable with `mochi:hydrate*`):

```svelte
<!-- Fetched only when scrolled into view -->
<UserAvatar mochi:defer:visible={{ rootMargin: '200px' }} userId={123} />
```

<SeeItInAction
demos={[
{ href: "/demos/hydration/", title: "Hydration Modes", hook: "The same component rendered five ways — eager, lazy, visible, rootMargin-tuned, and deferred server island." },
{ href: "/demos/lazy/", title: "Lazy Islands", hook: "Islands marked mochi:hydrate:visible hydrate and load their CSS only when scrolled into view." },
{ href: "/demos/server-island/", title: "Server Islands", hook: "Components marked mochi:defer render server-side on demand after the initial page is delivered." },
]}
/>
