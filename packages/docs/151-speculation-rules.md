---
title: 'Speculation Rules'
slug: speculation-rules
ogTitle: 'Instant navigations with Speculation Rules'
description: 'Prefetch and prerender same-site URLs via a typed speculationRules option, injected as a <script type="speculationrules"> tag.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Speculation Rules

<VersionNote since="0.10.0" message="The speculationRules option and the `mochi-framework speculation-rules` command are new in 0.10.0." />

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

## Generating a starting config

`mochi-framework speculation-rules` reads your `Mochi.serve({ routes })` call and writes a starting `speculationRules` key straight into your entry:

```sh
bunx mochi-framework speculation-rules            # writes into ./src/index.ts
bunx mochi-framework speculation-rules --dry-run  # print without writing
bunx mochi-framework speculation-rules --entry ./src/main.ts
```

It emits a broad `prefetch` rule matching every page route and a conservative `prerender` rule limited to your static pages, both excluding `/api/*` and `/_*`. Route patterns are emitted verbatim — `href_matches` speaks the same [URL Pattern](https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API) syntax as the router, so `/blog/:slug` matches one segment and never widens to `/blog/2024/01/post`. Your `trailingSlash` policy is applied so the generated URLs are the ones the server actually serves.

Re-running the command rewrites the rules in place, whether the key is inline, shorthand (`speculationRules,`), or a reference to a `const` declared in the same file. It is a **starting point** — edit it before shipping, then run your formatter to tidy it.

<Callout type="warning">

Prerendering fully loads a page in a hidden tab — it is far more expensive than prefetching, so keep it to a few high-likelihood destinations and prefer `eagerness: 'moderate'`. Exclude URLs with side effects (sign-out, add-to-cart, one-time-password flows). Links marked `[target=_blank]` or `[rel~=nofollow]` are excluded by the generated rules by default.

</Callout>
