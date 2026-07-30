---
title: 'Selective hydration with mochi:hydrate'
slug: selective-hydration
description: 'Mark components with mochi:hydrate to ship client JavaScript only where you need interactivity.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Selective hydration with `mochi:hydrate`

Components render on the server and ship zero JavaScript. Add `mochi:hydrate` to opt a component into client-side hydration. Everything else stays static HTML.

```svelte
<!-- file: src/routes/Page.svelte -->
<Counter mochi:hydrate count={5} />
<StaticHeader />
```

Mochi serializes props with `devalue` so the same values are available during hydration. See [Passing props to islands](/docs/island-props/) for the supported types.

### What is an island?

An island is any component you mark with a `mochi:*` directive: `mochi:hydrate`, `mochi:hydrate:visible`, `mochi:clientOnly`, `mochi:clientOnly:visible`, `mochi:defer`, or `mochi:defer:visible`. Everything else is server-rendered HTML that ships no JavaScript. The directive decides when and where the island runs.

### Supported import forms

Import an island statically from a **relative** `.svelte` / `.md` / `.svx` path in the same file's `<script>`. Default, named, and mixed imports all work.

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

Framework components from `mochi-framework/components` are the one package exception. Put a directive directly on the package import.

```svelte
<script>
  import { MochiCaptcha } from 'mochi-framework/components';
</script>

<MochiCaptcha mochi:hydrate />
```

Two forms are a **compile error**, surfaced on the dev error page and in `mochi-framework build`:

- **Third-party package imports** (`import { Widget } from 'some-ui-lib'`). Wrap the component in a local `.svelte` file and put the directive on the wrapper.
- **Components received through props, variables, or namespaces** (`<Item.Row mochi:hydrate />`). An island needs a statically known source file. Use the same wrapper fix.

```svelte
<!-- file: src/lib/Wrapped.svelte — local wrapper makes a third-party component an island -->
<script>
  import { Widget } from 'some-ui-lib';
  let props = $props();
</script>

<Widget {...props} />
```

These rules apply to every directive family: `mochi:hydrate*`, `mochi:defer*`, and `mochi:clientOnly*`.

<Callout type="info">

**Hydration is all-or-nothing per island.** A `mochi:hydrate` directive hydrates the whole subtree, so nesting one hydratable island inside another is a compile error. Mark the outermost component and let it cover everything below.

</Callout>

### `isHydratable()`

`isHydratable()` returns `true` when the calling component belongs to a subtree that will hydrate on this page load — `mochi:hydrate*`, `mochi:clientOnly*`, or `mochi:defer mochi:hydrate` — at any nesting depth. It returns `false` everywhere else (plain SSR, pure `mochi:defer` renders, emails). Use it to branch SSR-only fallback behavior.

```svelte
<!-- file: src/lib/Counter.svelte -->
<script lang="ts">
  import { isHydratable } from 'mochi-framework';

  let { count = 0 }: { count?: number } = $props();

  const hydratable = isHydratable();
</script>

{#if hydratable}
  <button onclick={() => count++}>{count}</button>
{:else}
  <span>{count}</span>
{/if}
```

<Callout type="info">

Like `getContext`, call `isHydratable()` during component initialization — at the top level of the `<script>` block, not inside an event handler or `$effect`.

</Callout>

### Unique ids with `$props.id()`

For an SSR-stable id inside an island, use Svelte's native [`$props.id()`](<https://svelte.dev/docs/svelte/$props#$props.id()>). The value from the server render is reused on hydration.

```svelte
<!-- file: src/lib/SignupField.svelte -->
<script lang="ts">
  const uid = $props.id();
</script>

<label for="{uid}-email">Email</label>
<input id="{uid}-email" type="email" />
```

Each instance gets its own id, so repeating the same island never produces duplicate DOM ids. It also works inside server islands: their ids are namespaced so a deferred fragment cannot collide with ids already on the page.

### `mochi:hydrate:visible`

Use `mochi:hydrate:visible` to defer hydration until the component scrolls into view. The component still server-renders. Only its JavaScript and CSS load on first intersection.

```svelte
<HeavyChart mochi:hydrate:visible />
<HeavyChart mochi:hydrate:visible={{ rootMargin: '200px' }} />
```

Pass `rootMargin` to start loading before the component enters the viewport. See [Lazy hydration](/docs/lazy-hydration/).

<Callout type="warning">

A `:visible` island loads its CSS with its bundle on intersection, not in the initial page `<head>`. It can briefly render unstyled. Use `mochi:hydrate` for anything that must look correct on the initial SSR load.

</Callout>

### `mochi:clientOnly`

Use `mochi:clientOnly` to skip SSR entirely. Mochi mounts the component in the browser only, with an optional fallback snippet as the SSR placeholder. See [Client-only components](/docs/client-only/).

```svelte
<AudioVisualizer mochi:clientOnly />
```

Add `:visible` to defer the browser mount until the placeholder scrolls into view, with the same `rootMargin` option.

```svelte
<AudioVisualizer mochi:clientOnly:visible={{ rootMargin: '200px' }} />
```

### `mochi:defer`

Use `mochi:defer` to render the component in a separate request after the page ships. Combine it with `mochi:hydrate` to also hydrate the deferred markup. See [Server islands](/docs/server-islands/).

```svelte
<ShoppingCart mochi:defer mochi:hydrate items={initialItems} />
```

Add `:visible` to defer the fetch until the placeholder scrolls into view.

```svelte
<UserAvatar mochi:defer:visible={{ rootMargin: '200px' }} userId={123} />
```

<SeeItInAction
demos={[
{ href: "/demos/hydration/", title: "Hydration Modes", hook: "How the hydration modes work — mochi:hydrate, mochi:hydrate:visible, rootMargin tuning, and mochi:defer server islands side by side." },
{ href: "/demos/lazy/", title: "Lazy Islands", hook: "How lazy hydration works — islands marked mochi:hydrate:visible hydrate and load their CSS only when scrolled into view." },
{ href: "/demos/server-island/", title: "Server Islands", hook: "How server islands work — components marked mochi:defer render server-side on demand after the initial page is delivered." },
]}
/>
