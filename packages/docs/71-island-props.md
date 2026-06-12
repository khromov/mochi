---
title: 'Passing props to islands'
slug: island-props
description: 'How props are serialized and passed to hydratable islands, including supported types and auto-injected framework props.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Passing props to islands

Pass props to a component marked with `mochi:hydrate`, `mochi:hydrate:visible`, or `mochi:defer` exactly as you would to any Svelte component — the framework serializes them with [`devalue`](https://github.com/Rich-Harris/devalue) so the same values reach the hydrating client.

```svelte
<!-- file: src/routes/Page.svelte -->
<script>
  const user = { name: 'Ada', id: 42 };
  const visitedAt = new Date();
  const tags = new Set(['svelte', 'bun']);
</script>

<UserCard mochi:hydrate {user} {visitedAt} {tags} />
```

Do **NOT** pass functions, class instances, or `Symbol` values as props; instead, send a plain-data representation and rebuild the value inside the island.

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

Avoid `$props<{ … }>()`. The `<…>` type-argument form isn't the recommended convention — type the `let { … }` declaration instead, e.g. `let { adjective }: { adjective: string } = $props()`.

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

For `mochi:defer` server islands the flow is similar, except props are HMAC-signed and passed as a query parameter to a per-island endpoint — see [Server islands](server-islands/).

### Supported types

- Plain objects and arrays
- Primitives: strings, numbers, booleans, `null`
- `Date`, `RegExp`, `Map`, `Set`, `URL`, `URLSearchParams`
- `BigInt`, typed arrays (`Uint8Array`, etc.)
- `undefined`, `Infinity`, `NaN`, `-0`
- Repeated and cyclic references (identity is preserved)

### Not supported

- Functions
- Class instances (the constructor is lost — only own enumerable properties survive)
- `Symbol`

### Auto-injected props

The framework appends two read-only props to every island invocation. Destructure them in `$props()` to use them:

```svelte
<!-- file: src/lib/UserCard.svelte -->
<script lang="ts">
  let {
    islandId,
    isHydratable,
    user,
  }: {
    islandId?: string;
    isHydratable?: boolean;
    user: { name: string; id: number };
  } = $props();
</script>
```

- `islandId` — string matching the wrapper's `island-id` attribute. Always present on `mochi:hydrate`, `mochi:hydrate:visible`, and `mochi:defer`.
- `isHydratable` — `true` when the call site uses `mochi:hydrate`, `mochi:hydrate:visible`, or `mochi:defer mochi:hydrate`. Undefined for pure SSR-only invocations and for bare `mochi:defer`.

Do **NOT** declare `islandId` or `isHydratable` as user-controlled props; instead, treat them as inputs the framework owns. See `Selective hydration with mochi:hydrate` for the branching pattern.
