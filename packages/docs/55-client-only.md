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

Children of the invocation render server-side as placeholder content and are removed the moment the component mounts:

```svelte
<ChartCanvas mochi:clientOnly data={points}>
  <div class="chart-skeleton">Loading chart…</div>
</ChartCanvas>
```

<Callout type="warning">

Fallback children are an SSR placeholder only — they are **not** passed to the component as a `children` snippet (snippets can't be serialized across the network boundary). Do **NOT** put `mochi:*` directives inside fallback children; instead, keep the fallback to static markup.

If the component types its props, the invocation still type-checks against them — declare `children?: Snippet` in the props type to satisfy `svelte-check`, even though it is never passed at runtime.

</Callout>

### Server-side APIs are unavailable

The component never runs on the server, so server-only APIs — `getRequestContext()`, `cookies`, `hydratable()` server reads — are unavailable inside it. Pass any server-derived values in as props from the page.

<Callout type="warning">

`<script module>` blocks **do** still execute during SSR — the page's import statement remains even though the component is never invoked. Keep module-scope code free of `window` and other browser globals; access them from the instance script or `$effect` instead.

</Callout>

### Limitations

- No `:visible` variant — the component mounts eagerly once its bundle loads.
- Combining `mochi:clientOnly` with `mochi:hydrate*` or `mochi:defer*` is a compile error — a client-only component is never server-rendered.
- Like other islands, it must not be nested inside another hydratable component.
