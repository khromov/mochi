---
title: 'Client-only components with mochi:clientOnly'
slug: client-only
description: 'Skip SSR and mount a component in the browser with mochi:clientOnly.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Client-only components with `mochi:clientOnly`

Add `mochi:clientOnly` to a component that must never render on the server. SSR emits an empty island wrapper. In the browser Mochi mounts the component. Use it for components built on browser-only APIs: `window`, canvas, `localStorage`, `requestAnimationFrame`, third-party browser SDKs.

```svelte
<!-- file: src/Page.svelte -->
<AudioVisualizer mochi:clientOnly />
```

Props work like `mochi:hydrate` — serialized with `devalue` and embedded into the HTML. See [Passing props to islands](/docs/island-props/). [`isHydratable()`](/docs/selective-hydration/#ishydratable) always returns `true` here, since the component only ever runs at client mount. For a unique id, use Svelte's `$props.id()`, which is minted fresh in the browser.

```svelte
<MapWidget mochi:clientOnly zoom={12} center={coords} />
```

### Fallback content

Pass fallback markup as children. It renders on the server as placeholder content and is removed the moment the component mounts.

```svelte
<ChartCanvas mochi:clientOnly data={points}>
  <div class="chart-skeleton">Loading chart…</div>
</ChartCanvas>
```

Type the component's props with `ClientOnlyProps<T>` so `svelte-check` accepts the fallback children:

```svelte
<script lang="ts">
  import type { ClientOnlyProps } from 'mochi-framework';
  let { data }: ClientOnlyProps<{ data: number[] }> = $props();
</script>
```

<Callout type="warning">

The fallback children are an SSR placeholder only. They do not reach the component at runtime, so do not render `children` inside a client-only component. Keep the fallback to static markup. Do **not** put `mochi:*` islands inside it — the fallback is wiped from the DOM when the component mounts.

</Callout>

### Lazy client-only with `mochi:clientOnly:visible`

Defer the browser mount until the wrapper scrolls into the viewport. The component still never renders on the server. Its JavaScript and CSS are fetched and mounted only when the placeholder intersects the viewport.

```svelte
<AudioVisualizer mochi:clientOnly:visible={{ rootMargin: '200px' }} />
```

Provide fallback children as the placeholder. They reserve space and give the observer something to watch until the component mounts.

```svelte
<ChartCanvas mochi:clientOnly:visible data={points}>
  <div class="chart-skeleton">Loading chart…</div>
</ChartCanvas>
```

### Server-side APIs are unavailable

The component never runs on the server, so `getRequestContext()`, `cookies`, and `hydratable()` server reads are unavailable inside it. Pass server-derived values in as props from the page.

<Callout type="warning">

`<script module>` blocks still run during SSR — the page's import statement remains even though the component is never invoked. Keep module-scope code free of `window` and other browser globals. Access them from the instance script or `$effect`.

</Callout>

### Limitations

- Combining `mochi:clientOnly*` with `mochi:hydrate*` or `mochi:defer*` is a compile error.
- Like other islands, a client-only component must not nest inside another hydratable component.
- Import it statically from a relative `.svelte` / `.md` / `.svx` path. See [Supported import forms](/docs/selective-hydration/#supported-import-forms).
