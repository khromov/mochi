---
title: 'Client-only components with mochi:clientOnly'
slug: client-only
description: 'Skip SSR entirely and mount a component in the browser with mochi:clientOnly.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Client-only components with `mochi:clientOnly`

Add `mochi:clientOnly` to a component that must never render on the server. SSR emits only an empty island wrapper; in the browser the component is mounted with Svelte's `mount()` (not hydrated — there is no SSR HTML to reuse). Use it for components built on browser-only APIs: `window`, canvas, `localStorage`, `requestAnimationFrame`, third-party browser SDKs.

```svelte
<!-- file: src/Page.svelte -->
<AudioVisualizer mochi:clientOnly />
```

Props work exactly like `mochi:hydrate` — serialized with `devalue` and embedded into the HTML. See `Passing props to islands` for the supported types. `isHydratable()` returns `true` throughout a client-only island's subtree (it always hydrates). There is **no** `islandId` prop on a client-only island — nothing renders server-side, so there's no id to carry; for a unique id inside the component, use Svelte's `$props.id()`, which `mount()` mints fresh in the browser.

```svelte
<MapWidget mochi:clientOnly zoom={12} center={coords} />
```

### Fallback content

Pass fallback markup as children — it renders server-side as placeholder content and is removed the moment the component mounts:

```svelte
<ChartCanvas mochi:clientOnly data={points}>
  <div class="chart-skeleton">Loading chart…</div>
</ChartCanvas>
```

For `svelte-check` to accept the fallback children, the client-only component types its props with `ClientOnlyProps<T>` — it adds an optional `children` snippet so the call site type-checks without you declaring a `children` prop by hand:

```svelte
<script lang="ts">
  import type { ClientOnlyProps } from 'mochi-framework';
  let { data }: ClientOnlyProps<{ data: number[] }> = $props();
</script>
```

<Callout type="warning">

The fallback children are an SSR placeholder only — they are **not** passed to the component at runtime, so don't render `children` inside a client-only component. Keep the fallback to static markup: do **NOT** put `mochi:*` islands inside it, since it is wiped from the DOM when the component mounts.

</Callout>

### Lazy client-only with `mochi:clientOnly:visible`

Defer the browser-side `mount()` until the wrapper scrolls into the viewport. The component still never renders on the server — its JavaScript and CSS are simply fetched and mounted only when the placeholder intersects the viewport via `IntersectionObserver`.

```svelte
<AudioVisualizer mochi:clientOnly:visible />
```

Pass `rootMargin` to start loading before the element enters the viewport — forwarded straight to `IntersectionObserver` (default `'0px'`):

```svelte
<AudioVisualizer mochi:clientOnly:visible={{ rootMargin: '200px' }} />
```

Provide fallback children as the placeholder — they reserve space and give the observer something to watch until the component mounts (an empty wrapper still gets a 1px minimum height so it remains observable):

```svelte
<ChartCanvas mochi:clientOnly:visible data={points}>
  <div class="chart-skeleton">Loading chart…</div>
</ChartCanvas>
```

### Server-side APIs are unavailable

The component never runs on the server, so server-only APIs — `getRequestContext()`, `cookies`, `hydratable()` server reads — are unavailable inside it. Pass any server-derived values in as props from the page.

<Callout type="warning">

`<script module>` blocks **do** still execute during SSR — the page's import statement remains even though the component is never invoked. Keep module-scope code free of `window` and other browser globals; access them from the instance script or `$effect` instead.

</Callout>

### Limitations

- Combining `mochi:clientOnly*` with `mochi:hydrate*` or `mochi:defer*` is a compile error — a client-only component is never server-rendered.
- Like other islands, it must not be nested inside another hydratable component.
