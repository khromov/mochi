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

### Props

| Prop       | Type                 | Default  | Description                                                           |
| ---------- | -------------------- | -------- | --------------------------------------------------------------------- |
| `type`     | `'fade' \| 'slide'`  | `'fade'` | The transition preset.                                                |
| `duration` | `number` (ms)        | `250`    | Animation duration.                                                   |
| `regions`  | `string \| string[]` | —        | Confine the animation to elements with these `view-transition-name`s. |

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

<Callout type="info">

Each `view-transition-name` must be **unique per document** — don't reuse one name across several elements on the same page.

</Callout>

<Callout type="info">

Cross-document view transitions are supported in current Chromium browsers. Where unsupported the navigation just happens with no animation — nothing to polyfill, nothing breaks.

</Callout>

### Keeping elements still

By default the whole page crossfades. To hold a persistent element — a header or sidebar — in place, give it a [`view-transition-name`](https://developer.mozilla.org/en-US/docs/Web/CSS/view-transition-name) in your own CSS. That lifts it out of the page crossfade:

```css
.sidebar {
  view-transition-name: sidebar;
}
/* hold it completely still instead of crossfading its snapshots */
::view-transition-old(sidebar),
::view-transition-new(sidebar) {
  animation: none;
}
```
