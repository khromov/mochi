---
title: 'Passing props to islands'
slug: island-props
description: 'How props are serialized and passed to hydratable islands, including supported types and auto-injected framework props.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Passing props to islands

Pass props to a component marked with `mochi:hydrate`, `mochi:hydrate:visible`, or `mochi:defer` exactly as you would to any Svelte component — the framework serializes them so the same values reach the client. Hydratable islands (`mochi:hydrate*`) use [`devalue`](https://github.com/Rich-Harris/devalue); `mochi:defer` server islands use [`msgpackr`](https://github.com/kriszyp/msgpackr), which roughly halves the token they put in the URL. Both preserve the same types (see [Supported types](#supported-types)).

```svelte
<!-- file: src/routes/Page.svelte -->
<script>
  const user = { name: 'Ada', id: 42 };
  const visitedAt = new Date();
  const tags = new Set(['svelte', 'bun']);
</script>

<UserCard mochi:hydrate {user} {visitedAt} {tags} />
```

### Typing props

Put the type on the `let { … } = $props()` declaration — don't pass a type argument to `$props()` itself. For a handful of props, inline the type after the destructuring:

```svelte
<script lang="ts">
  let { adjective }: { adjective: string } = $props();
</script>
```

For larger or reused shapes, pull it out into a `Props` interface:

```svelte
<script lang="ts">
  interface Props {
    title: string;
    count?: number;
    user: { name: string; id: number };
  }

  let { title, count = 0, user }: Props = $props();
</script>
```

<Callout type="warning">

Avoid the `$props<{ … }>()` type-argument form — always annotate the `let { … }` declaration as shown above.

</Callout>

Snippet props (including `children`) are typed with the `Snippet` interface from `svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

{@render children()}
```

When a component wraps a native element and forwards the rest of its attributes, type the spread with the matching interface from [`svelte/elements`](https://svelte.dev/docs/svelte/typescript#Typing-wrapper-components):

```svelte
<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';

  let { children, ...rest }: HTMLButtonAttributes = $props();
</script>

<button {...rest}>{@render children?.()}</button>
```

### Wire format

For `mochi:hydrate*` islands, props are emitted as a `<script type="application/json" id="mochi-props-N">` block placed just before the island. When several islands on a page share the exact same payload, the block is emitted once before the first of them and the rest reference it by id — so identical props ship over the wire only once.

For `mochi:defer` server islands the flow differs: props are packed with `msgpackr`, encrypted (opaque on the wire), and passed as a query parameter to a per-island endpoint — see [Server islands](/docs/server-islands/). msgpack keeps the token short, which matters because it travels in the URL.

### Supported types

- Plain objects and arrays
- Primitives: strings, numbers, booleans, `null`
- `Date`, `RegExp`, `Map`, `Set`, `URL`, `URLSearchParams`
- `BigInt`, typed arrays (`Uint8Array`, etc.)
- `undefined`, `Infinity`, `NaN`, `-0`
- Repeated and cyclic references (identity is preserved)

> One difference between the two codecs: `mochi:defer` server islands (msgpackr) restore `-0` as `+0`. Hydratable islands (devalue) preserve `-0`. Everything else above is identical across both.

### Not supported

- Functions
- Class instances (the constructor is lost — only own enumerable properties survive)
- `Symbol`

### Detecting hydration

To branch on whether the current render will hydrate, call [`isHydratable()`](/docs/selective-hydration/#ishydratable) — it works in any component at any nesting depth, with no prop involved:

```svelte
<!-- file: src/lib/UserCard.svelte -->
<script lang="ts">
  import { isHydratable } from 'mochi-framework';

  let { user }: { user: { name: string; id: number } } = $props();

  const hydratable = isHydratable();
</script>
```

`islandId` is a reserved name on every island (`mochi:hydrate` and `mochi:defer` alike) — passing it as a literal prop is a compile error, so a component can move between directives without the name silently changing meaning. On `mochi:defer` it is also the framework's transport key inside the encrypted envelope, stripped server-side before the component renders; a spread carrying it there is overridden by the framework value (last key wins). For a unique id inside the component, use `$props.id()`.

<SeeItInAction
demos={[
{ href: "/demos/island-props/", title: "Crossing the server-client boundary with props", hook: "How props cross the server-client boundary — Date, Map, Set, BigInt, URL, typed arrays, and even cyclic refs survive devalue's round-trip into a hydrated island." },
{ href: "/demos/prop-dedup/", title: "Shared Props", hook: "How island prop deduplication works — nine islands share three unique payloads, each serialized once and referenced via props-ref." },
{ href: "/demos/props-id/", title: "Unique IDs", hook: "How stable island IDs work — Svelte's native $props.id() gives SSR-consistent, per-instance ids, namespaced inside server islands." },
]}
/>
