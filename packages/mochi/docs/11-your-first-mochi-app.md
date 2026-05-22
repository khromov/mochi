---
title: 'Your first Mochi app'
slug: your-first-mochi-app
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Your first Mochi app

Let's build a small app that exercises every server/client boundary you'll touch in real code. We'll put together a single `/hello` page in four steps, picking up one pillar at a time: [`serverProps`](/docs/defining-routes/) for loading data on every request, [passing props to islands](/docs/island-props/) so a server-rendered parent can hand values to a hydrated child, [`mochi:hydrate`](/docs/selective-hydration/) for one interactive island while the rest stays zero-JS, and [`mochi:defer`](/docs/server-islands/) for a server island that renders separately from the main request.

By the end we'll have a greeting card with a live like button and a personalized welcome that streams in after the page loads.

### Set up

Scaffold a new project with the official CLI and pick the **minimal** template when prompted:

```sh
bun create mochi@latest my-app
# choose: minimal
cd my-app
bun install
bun run dev
```

The scaffold gives you a working app on `http://localhost:3333`. Its entry point is `src/index.ts`, which just boots the server with the routes we'll define in the next step:

```ts
// file: src/index.ts (scaffolded — we won't change this)
import { Mochi } from 'mochi-framework';
import { routes } from './routes';

const PORT = Number(process.env.PORT) || 3333;

await Mochi.serve({
  port: PORT,
  development: process.env.MODE === 'development',
  routes,
});
```

You won't need to touch `index.ts` again in this walkthrough — everything else lives in `routes.ts` and the Svelte components we're about to build.

### Step 1 — Register the route

Now let's point `/hello` at a Svelte page and give it some data to render. Open `src/routes.ts` and replace the scaffolded route with this one. `serverProps` is either a plain object or a `(req, params) => props` resolver — whatever it returns becomes the page component's `$props`.

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

The resolver runs on every request, so each reload produces a fresh `renderedAt`. See [Defining routes](/docs/defining-routes/) for the full `serverProps` contract and the other `Mochi.*` route helpers.

### Step 2 — The page component

Next, let's write the page itself. `Hello.svelte` stays server-only (all `Mochi.page()` entry components are server-only) — it consumes the `serverProps`, renders a static layout, and mounts the two child islands we'll build next. Notice that even though it imports two components that ship JavaScript, this file itself ships zero: the `mochi:` directives where we render the components decide what hydrates.

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

<Callout type="warning">

Island props end up serialized into the HTML payload, so they're **visible to the client**. Never pass secrets, API keys, or session tokens this way.

</Callout>

### Step 3 — A hydrated island

Now let's give the user something to click! `LikeButton.svelte` is a normal Svelte 5 component — we accept `initialLikes` as a prop, keep a `$state` counter, and bump it on click.

```svelte
<!-- file: src/LikeButton.svelte -->
<script lang="ts">
  let { initialLikes } = $props<{ initialLikes: number }>();
  let likes = $state(initialLikes);
</script>

<button onclick={() => likes++}>♥ {likes}</button>
```

<Callout type="tip">

The `mochi:hydrate` directive lives **where we render the component** in `Hello.svelte`, not inside the island itself. The same component can be mounted statically elsewhere.

</Callout>

### Step 4 — A server island

Finally, let's add a personalized greeting that doesn't block the rest of the page. We marked `Visitor.svelte` with `mochi:defer` back in Step 2, so it skips the initial SSR pass — the page ships with our `<p>Loading…</p>` fallback in its place. The browser then fetches the component _in a separate request_, the server renders it, and the result swaps in.

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
