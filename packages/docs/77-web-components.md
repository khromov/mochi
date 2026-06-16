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

Register it — and any element from npm — with `importWebComponent()` inside the island, then use the tags in markup:

```svelte
<script>
  import { importWebComponent } from 'mochi-framework';

  await importWebComponent('./click-counter.ts'); // local
  await importWebComponent('@github/relative-time-element'); // from npm
</script>

<click-counter></click-counter>
<relative-time datetime="2026-01-01T00:00:00Z">Jan 1, 2026</relative-time>
```

Mark the island `mochi:hydrate` from the page. After hydration the registrations run, the `define()` calls fire, and the server-rendered tags upgrade in place. Registration is global, so a custom element registered by one island upgrades matching tags anywhere on the page.

See the [Web Components demo](/demos/web-components/).

<Callout type="info">

Why `importWebComponent()` and not a plain `import`? A custom-element module references `HTMLElement` and calls `customElements.define()` when it loads — which crashes Bun's server runtime during SSR. Mochi rewrites `importWebComponent('…')` at build time: on the **server** it becomes a no-op (the module never loads), and on the **client** it becomes a dynamic `import('…')` (so it's bundled and registers on hydration). The argument must be a **static string literal**, exactly like a native dynamic `import()`.

</Callout>

<Callout type="info">

This only handles **registration** — it doesn't render shadow DOM on the server. Give custom elements meaningful light-DOM fallback content (e.g. `<relative-time …>Jan 1, 2026</relative-time>`). That's what renders during SSR, before the island hydrates and the element upgrades.

</Callout>
