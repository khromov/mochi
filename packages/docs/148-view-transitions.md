---
title: 'View Transitions'
slug: view-transitions
description: 'Animate full-page navigations with the browser cross-document View Transitions API — zero JavaScript.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## View Transitions

`<ViewTransitions />` opts your app into the browser's cross-document [View Transitions API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API), animating full-page navigations with **zero client JavaScript**. Mochi is an MPA — every navigation is a real page load — so the browser does the work; you just declare the animation.

Render it from a component that appears on **every** page (both the page you leave and the one you land on must opt in), e.g. a shared page shell component:

```svelte
<script>
  import { ViewTransitions } from 'mochi-framework/components';
</script>

<ViewTransitions type="fade" />

...
```

Navigate between pages and they crossfade. That's the whole setup.

<Callout type="warning">

Render exactly **one** `<ViewTransitions />` per page — two instances would emit the same global `@keyframes` names and competing rules. If a second one renders anyway (say, one from a layout and one from a page), it logs a warning and emits nothing; the first instance wins.

</Callout>

### Props

| Prop       | Type                 | Default  | Description                                                           |
| ---------- | -------------------- | -------- | --------------------------------------------------------------------- |
| `type`     | `'fade' \| 'slide'`  | `'fade'` | The transition preset.                                                |
| `duration` | `number` (ms)        | `250`    | Animation duration.                                                   |
| `regions`  | `string \| string[]` | —        | Confine the animation to elements with these `view-transition-name`s. |
| `keep`     | `string \| string[]` | —        | CSS selectors for persistent chrome to hold still across navigations. |

```svelte
<ViewTransitions type="slide" duration={400} />
```

Both presets animate the page root, so they apply to any page with no per-element setup, and reduced-motion users get no animation automatically.

### Animating only part of the page

The View Transitions API always snapshots the **whole viewport** — you can't restrict the capture to a subtree. What you can scope is _which parts animate_. Pass `regions` to confine the transition to elements you've given a [`view-transition-name`](https://developer.mozilla.org/en-US/docs/Web/CSS/view-transition-name); everything else swaps instantly instead of cross-fading.

```svelte
<ViewTransitions type="slide" regions="card" />

<section style="view-transition-name: card">…</section>
```

```svelte
<!-- multiple named regions -->
<ViewTransitions regions={['card', 'hero']} />
```

An empty array (`regions={[]}`) disables the animation entirely — everything swaps instantly.

<Callout type="info">

Each `view-transition-name` must be **unique per document** — don't reuse one name across several elements on the same page.

</Callout>

<Callout type="info">

Cross-document view transitions are supported in current Chromium browsers. Where unsupported the navigation just happens with no animation — nothing to polyfill, nothing breaks.

</Callout>

### Keeping elements still

By default the whole page crossfades. To hold persistent chrome — a banner, sidebar, or header — still instead, pass `keep` a list of CSS selectors. Each matched element is lifted out of the page crossfade and frozen (both its position and its snapshots) while the rest of the page transitions:

```svelte
<ViewTransitions type="fade" keep={['.banner', '.sidebar']} />
```

`keep` assigns each selector a unique `view-transition-name` and emits the freeze CSS for you, so there's nothing to hand-write. Render the same list on every page — i.e. from your shared layout — so the page you leave and the page you land on agree.

<Callout type="warning">

Each selector must match **exactly one** element per page. `view-transition-name`s are unique per document, so a selector that matches several elements breaks the transition.

</Callout>

If you'd rather wire it by hand — or need finer control — give the element a [`view-transition-name`](https://developer.mozilla.org/en-US/docs/Web/CSS/view-transition-name) in your own CSS and zero its animations; that's exactly what `keep` generates:

```css
.sidebar {
  view-transition-name: sidebar;
}
::view-transition-group(sidebar),
::view-transition-old(sidebar),
::view-transition-new(sidebar) {
  animation: none;
}
```
