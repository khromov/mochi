---
title: 'Passing props to islands'
slug: island-props
description: 'How Mochi serializes props for hydratable islands, the supported types, and reserved names.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Passing props to islands

Pass props to a component marked `mochi:hydrate`, `mochi:hydrate:visible`, or `mochi:defer` as you would to any Svelte component. Mochi serializes them with [`devalue`](https://github.com/Rich-Harris/devalue) so the same values reach the hydrating client.

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

Put the type on the `let { … } = $props()` declaration. For a few props, inline the type:

```svelte
<script lang="ts">
  let { adjective }: { adjective: string } = $props();
</script>
```

For larger or reused shapes, use a `Props` interface:

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

Annotate the `let { … }` declaration. Avoid the `$props<{ … }>()` type-argument form.

</Callout>

Type snippet props (including `children`) with the `Snippet` interface from `svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

{@render children()}
```

When a component wraps a native element and forwards its attributes, type the spread with the matching interface from [`svelte/elements`](https://svelte.dev/docs/svelte/typescript#Typing-wrapper-components):

```svelte
<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';

  let { children, ...rest }: HTMLButtonAttributes = $props();
</script>

<button {...rest}>{@render children?.()}</button>
```

### How props travel

For `mochi:hydrate*` islands, props ship inline in the page HTML. When several islands share the same payload, it ships over the wire once and the rest reference it, which keeps the page small. For `mochi:defer` server islands, props are encrypted (opaque on the wire) and passed to a per-island endpoint. See [Server islands](/docs/server-islands/).

### Supported types

- Plain objects and arrays
- Primitives: strings, numbers, booleans, `null`
- `Date`, `RegExp`, `Map`, `Set`, `URL`, `URLSearchParams`
- `BigInt`, typed arrays (`Uint8Array`, and so on)
- `undefined`, `Infinity`, `NaN`, `-0`
- Repeated and cyclic references (identity is preserved)

### Unsupported types

- Functions
- Class instances (only own enumerable properties survive)
- `Symbol`

### Detecting hydration

To branch on whether the current render will hydrate, call [`isHydratable()`](/docs/selective-hydration/#ishydratable). It works in any component at any nesting depth, with no prop involved.

```svelte
<!-- file: src/lib/UserCard.svelte -->
<script lang="ts">
  import { isHydratable } from 'mochi-framework';

  let { user }: { user: { name: string; id: number } } = $props();

  const hydratable = isHydratable();
</script>
```

`islandId` is a reserved name on every island. Passing it as a literal prop is a compile error, so a component can move between directives without the name changing meaning. For a unique id inside the component, use `$props.id()`.

<SeeItInAction
demos={[
{ href: "/demos/island-props/", title: "Crossing the server-client boundary with props", hook: "How props cross the server-client boundary — Date, Map, Set, BigInt, URL, typed arrays, and even cyclic refs survive devalue's round-trip into a hydrated island." },
{ href: "/demos/prop-dedup/", title: "Shared Props", hook: "How island prop deduplication works — nine islands share three unique payloads, each serialized once and referenced via props-ref." },
{ href: "/demos/props-id/", title: "Unique IDs", hook: "How stable island IDs work — Svelte's native $props.id() gives SSR-consistent, per-instance ids, namespaced inside server islands." },
]}
/>
