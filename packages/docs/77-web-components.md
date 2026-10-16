---
title: 'Web Components'
slug: web-components
description: 'Use custom elements — local or from npm — by registering them inside a hydratable island.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Web Components

Custom elements work in Mochi. Svelte renders unknown hyphenated tags verbatim during SSR, and Bun bundles whatever a hydratable island imports. A custom element just needs its `customElements.define()` to run on the client — so register it inside a hydratable island.

A local element is plain DOM, defined in its own module:

```ts
// click-counter.ts
class ClickCounter extends HTMLElement {
  connectedCallback() {
    this.attachShadow({ mode: 'open' }).innerHTML = '<button>Click</button>';
  }
}

// Guard against double-define — the island module can re-evaluate across HMR.
if (!customElements.get('click-counter')) {
  customElements.define('click-counter', ClickCounter);
}
```

Custom elements reference `HTMLElement` and `customElements` at module-eval time, so they must not load during SSR. Gate the imports on [`isBrowser`](/docs/environment-constants/) and use dynamic `import()` so they stay out of the server path:

```svelte
<script>
  import { isBrowser } from 'mochi-framework';

  if (isBrowser) {
    import('./click-counter.ts'); // local
    import('@github/relative-time-element'); // from npm
  }
</script>

<click-counter></click-counter>
<relative-time datetime="2026-01-01T00:00:00Z">Jan 1, 2026</relative-time>
```

Mark the island `mochi:hydrate` from the page. After hydration the imports run on the client, the `define()` calls fire, and the server-rendered tags upgrade in place. Registration is global, so a custom element registered by one island upgrades matching tags anywhere on the page.

See the [Web Components demo](/demos/web-components/).

<Callout type="info">

Give custom elements meaningful fallback content (e.g. `<relative-time …>Jan 1, 2026</relative-time>`). It's what renders during SSR, before the island hydrates and the element upgrades.

</Callout>
