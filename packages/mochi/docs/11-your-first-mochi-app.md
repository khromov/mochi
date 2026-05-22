---
title: 'Your first Mochi app'
slug: your-first-mochi-app
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Your first Mochi app

Let's build a small app that exercises every server/client boundary you'll touch in real code. We'll put together a single `/hello` page in four steps, picking up one pillar at a time:

- [`serverProps`](/docs/defining-routes/) — load data on every request and pass it into the page component
- [Passing props to islands](/docs/island-props/) — a server-rendered parent handing a value to a hydrated child
- [`mochi:hydrate`](/docs/selective-hydration/) — one interactive island so the rest stays zero-JS
- [`mochi:defer`](/docs/server-islands/) — a server island that renders separately from the main request

By the end we'll have a greeting card with a live like button and a personalized welcome that streams in after the page loads.

### Step 1 — Register the route

We'll start by pointing `/hello` at a Svelte page and giving it some data to render. `serverProps` is either a plain object or a `(req, params) => props` resolver — whatever it returns becomes the page component's `$props`.

```ts
// file: src/routes.ts
import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/hello': Mochi.page('./src/Hello.svelte', {
    serverProps: () => ({
      siteName: 'Mochi',
      renderedAt: new Date().toISOString(),
    }),
  }),
};
```

The resolver runs on every request, so each reload produces a fresh `renderedAt`. Wire `routes` into `Mochi.serve({ routes })` from `src/index.ts` if you haven't already — see [Defining routes](/docs/defining-routes/).

### Step 2 — The page component

Next, let's write the page itself. `Hello.svelte` stays server-only — it consumes the `serverProps`, renders a static layout, and mounts the two child islands we'll build next. Notice that even though it imports two components that ship JavaScript, this file itself ships zero: the directives at the call site decide what hydrates.

```svelte
<!-- file: src/Hello.svelte -->
<script lang="ts">
  import LikeButton from './LikeButton.svelte';
  import Visitor from './Visitor.svelte';

  let { siteName, renderedAt } = $props<{ siteName: string; renderedAt: string }>();
</script>

<h1>Welcome to {siteName}</h1>
<p>Rendered at <code>{renderedAt}</code></p>

<LikeButton mochi:hydrate initialLikes={42} />

<Visitor mochi:defer>
  <p>Loading…</p>
</Visitor>
```

The `initialLikes={42}` value crosses the server→client boundary. Mochi serializes island props with [`devalue`](/docs/island-props/), so `Date`, `Map`, `Set`, `BigInt`, and cyclic references all survive the trip — not just JSON-safe values.

### Step 3 — A hydrated island

Now let's give the page something to click. `LikeButton.svelte` is a normal Svelte 5 component — we accept `initialLikes` as a prop, keep a `$state` counter, and bump it on click.

```svelte
<!-- file: src/LikeButton.svelte -->
<script lang="ts">
  let { initialLikes } = $props<{ initialLikes: number }>();
  let likes = $state(initialLikes);
</script>

<button onclick={() => likes++}>♥ {likes}</button>
```

<Callout type="tip">

The `mochi:hydrate` directive lives at the **call site** in `Hello.svelte`, not inside the island itself. The same component can be mounted statically elsewhere — only the call site with the directive ships JavaScript.

</Callout>

### Step 4 — A server island

Finally, let's add a personalized greeting that doesn't block the rest of the page. We marked `Visitor.svelte` with `mochi:defer` back in Step 2, so it skips the initial SSR pass — the page ships with a `<mochi-server-island>` placeholder containing our `<p>Loading…</p>` fallback. The browser then fetches `/_mochi/island/Visitor`, the server renders the component, and the resulting HTML swaps in.

Because it still runs on the server, the component has full access to the request via `getRequestContext()` — including cookies:

```svelte
<!-- file: src/Visitor.svelte -->
<script lang="ts">
  import { getRequestContext } from 'mochi-framework';

  const { cookies } = getRequestContext();
  const name = cookies.get('visitor_name') ?? 'friend';
</script>

<p>Welcome back, {name}!</p>
```

That's the trick for keeping an HTML page cacheable while still personalizing parts of it: the outer `Hello.svelte` is identical for every visitor, but the deferred `Visitor` fragment can read per-request state on its own.

### What's next

- [Defining routes](/docs/defining-routes/) — `Mochi.page`, `Mochi.api`, `Mochi.ws`, `Mochi.sse`, and the full `serverProps` contract
- [Selective hydration](/docs/selective-hydration/) — `mochi:hydrate`, `islandId`, `isHydratable`
- [Lazy hydration](/docs/lazy-hydration/) — `mochi:hydrate:visible` for below-the-fold islands
- [Server islands](/docs/server-islands/) — `mochi:defer`, signed props, and `MOCHI_KEY`
- [Passing props to islands](/docs/island-props/) — every type `devalue` can round-trip
