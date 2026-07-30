---
title: 'View Transitions'
slug: view-transitions
description: 'Animate full-page navigations with the browser cross-document View Transitions API and zero JavaScript.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## View Transitions

`<ViewTransitions />` opts your app into the browser's cross-document [View Transitions API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API), animating full-page navigations with **zero client JavaScript**. Mochi is an MPA, so every navigation is a real page load. The browser does the work. You declare the animation.

Render it from a component that appears on **every** page — for example, a shared page shell. Both the page you leave and the page you land on must opt in.

```svelte
<script>
  import { ViewTransitions } from 'mochi-framework/components';
</script>

<ViewTransitions type="fade" />
```

Navigate between pages and they crossfade. That is the whole setup.

<Callout type="warning">

Render exactly **one** `<ViewTransitions />` per page. Two instances would emit the same global `@keyframes` names and competing rules. If a second one renders, it logs a warning and emits nothing; the first instance wins.

</Callout>

### Props

| Prop                   | Type                                               | Default  | Description                                                             |
| ---------------------- | -------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| `type`                 | `'fade' \| 'slide' \| 'scale' \| 'blur' \| 'flip'` | `'fade'` | The transition preset.                                                  |
| `custom`               | `{ out?: string; in?: string }`                    | —        | Custom keyframe bodies. Overrides `type`.                               |
| `duration`             | `number` (ms)                                      | `250`    | Animation duration.                                                     |
| `easing`               | `string`                                           | `'ease'` | The animation timing function.                                          |
| `regions`              | `string \| string[]`                               | —        | Confine the animation to elements with these `view-transition-name`s.   |
| `keepElementSelectors` | `string \| string[]`                               | —        | CSS selectors for persistent chrome to hold still across navigations.   |

```svelte
<ViewTransitions type="slide" duration={400} easing="cubic-bezier(0.22, 1, 0.36, 1)" />
```

Five presets ship built in: `fade`, `slide`, `scale`, `blur`, and `flip`. They animate the page root, so they apply to any page with no per-element setup, and reduced-motion users get no animation automatically.

### Custom transitions

Pass `custom` to bring your own animation. `out` and `in` are the **body** of each keyframe for the page you leave and the page you land on. Mochi wraps each into an `@keyframes` for you.

```svelte
<ViewTransitions
  custom={{
    out: 'to { opacity: 0; transform: rotate(8deg) }',
    in: 'from { opacity: 0; transform: rotate(-8deg) }',
  }}
  easing="cubic-bezier(0.22, 1, 0.36, 1)"
/>
```

Either side is optional. `custom` composes with `duration`, `easing`, `regions`, `keepElementSelectors`, and reduced-motion.

<Callout type="info">

When `custom` is set it overrides `type`, so you can leave `type` unset.

</Callout>

### Animating only part of the page

The API always snapshots the whole viewport. You can scope which parts animate. Pass `regions` to confine the transition to elements you gave a [`view-transition-name`](https://developer.mozilla.org/en-US/docs/Web/CSS/view-transition-name). Everything else swaps instantly.

```svelte
<ViewTransitions type="slide" regions="card" />

<section style="view-transition-name: card">…</section>
```

An empty array (`regions={[]}`) disables the animation entirely.

<Callout type="info">

Each `view-transition-name` must be unique per document. Do not reuse one name across several elements on the same page.

</Callout>

### Keeping elements still

To hold persistent chrome — a banner, sidebar, or header — still while the rest of the page transitions, pass `keepElementSelectors` a list of CSS selectors. Mochi assigns each selector a unique `view-transition-name` and emits the freeze CSS. Render the same list on every page.

```svelte
<ViewTransitions type="fade" keepElementSelectors={['.banner', '.sidebar']} />
```

<Callout type="warning">

Each selector must match exactly one element per page. `view-transition-name`s are unique per document, so a selector that matches several elements breaks the transition.

</Callout>

<Callout type="info">

Cross-document view transitions are supported in current Chromium browsers. Where unsupported, the navigation happens with no animation.

</Callout>

<SeeItInAction
demos={[
{ href: "/demos/view-transitions/", title: "View Transitions", hook: "Drop <ViewTransitions /> into a layout to animate navigations with zero JavaScript." },
{ href: "/demos/custom-transitions/", title: "Custom Transitions", hook: "Supply your own @keyframes to <ViewTransitions /> via custom={{ in, out }}." },
]}
/>
