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

Props work exactly like `mochi:hydrate` — serialized with `devalue` and embedded into the HTML. See `Passing props to islands` for the supported types. The implicit `islandId` and `isHydratable` props are still injected at mount (`isHydratable` is `true`).

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

### Server-side APIs are unavailable

The component never runs on the server, so server-only APIs — `getRequestContext()`, `cookies`, `hydratable()` server reads — are unavailable inside it. Pass any server-derived values in as props from the page.

<Callout type="warning">

`<script module>` blocks **do** still execute during SSR — the page's import statement remains even though the component is never invoked. Keep module-scope code free of `window` and other browser globals; access them from the instance script or `$effect` instead.

</Callout>

### Limitations

- Combining `mochi:clientOnly` with `mochi:hydrate*` or `mochi:defer*` is a compile error — a client-only component is never server-rendered.
- Like other islands, it must not be nested inside another hydratable component.
