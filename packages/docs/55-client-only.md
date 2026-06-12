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

Pass a snippet as the directive value — it renders server-side as placeholder content and is removed the moment the component mounts:

```svelte
{#snippet chartSkeleton()}
  <div class="chart-skeleton">Loading chart…</div>
{/snippet}

<ChartCanvas mochi:clientOnly={chartSkeleton} data={points} />
```

<Callout type="warning">

The fallback snippet is an SSR placeholder only — it is **not** passed to the component (snippets can't be serialized across the network boundary). Keep it to static markup: do **NOT** put `mochi:*` islands inside it, since the fallback is wiped from the DOM when the component mounts.

Children of a `mochi:clientOnly` invocation are a compile error — they would force the component to declare a phantom `children` prop just to satisfy `svelte-check`. The snippet form has no such requirement.

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
