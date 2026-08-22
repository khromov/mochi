---
title: 'Speculation Rules'
slug: speculation-rules
ogTitle: 'Instant navigations with Speculation Rules'
description: 'Prefetch and prerender same-site URLs via a typed speculationRules option, injected as a <script type="speculationrules"> tag.'
---

<script>
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Speculation Rules

<VersionNote since="0.10.0" message="The speculationRules option is new in 0.10.0." />

The [Speculation Rules API](https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API) lets the browser prefetch or prerender same-site URLs ahead of a navigation, so the next page loads instantly. Pass a typed `speculationRules` object to `Mochi.serve()` and Mochi injects it as a `<script type="speculationrules">` tag in every page's `<head>`.

```ts
import { Mochi } from 'mochi-framework';
import type { SpeculationRules } from 'mochi-framework';

const speculationRules: SpeculationRules = {
  prefetch: [
    {
      where: {
        and: [{ href_matches: '/*' }, { not: { href_matches: '/api/*' } }, { not: { selector_matches: '[rel~=nofollow]' } }],
      },
      eagerness: 'moderate',
    },
  ],
  prerender: [{ where: { href_matches: '/' }, eagerness: 'moderate' }],
};

await Mochi.serve({ speculationRules, routes });
```

Both `prefetch` and `prerender` are optional. An omitted option — or an object whose arrays are both empty — injects nothing.

Rules are either **document rules** (`where` matches links on the page) or **list rules** (`urls` names explicit targets):

```ts
const listRules: SpeculationRules = {
  prefetch: [{ urls: ['/pricing', '/docs/'] }],
};
```

`href_matches` speaks the same [URL Pattern](https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API) syntax as the router, so a route pattern can be used verbatim: `/blog/:slug` matches one segment, while `*` crosses them. Match the URLs your server actually serves — with `trailingSlash: 'always'`, that means `/about/`, not `/about`.

### An important note about prerendering

Prerendering fully loads a page in a hidden tab — it is far more expensive than prefetching, so keep it to a few high-likelihood destinations and prefer `eagerness: 'moderate'`. Exclude URLs with side effects (sign-out, add-to-cart, one-time-password flows), and add `not: { selector_matches: '[rel~=nofollow]' }` and `[target=_blank]` guards so flagged links are left alone.

That hidden tab also runs the page's scripts, so an analytics snippet reports a pageview for a visit that may never happen. Gate the initialisation on activation — wherever the snippet lives, usually your [HTML shell](/docs/custom-html-shell/):

```js
if (document.prerendering) {
  document.addEventListener('prerenderingchange', initAnalytics, { once: true });
} else {
  initAnalytics();
}
```

Google Analytics already defers itself this way; most other vendors do not. For code that runs after load, `performance.getEntriesByType('navigation')[0]?.activationStart > 0` tells you the page was prerendered rather than visited directly.
