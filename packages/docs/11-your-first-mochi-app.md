---
title: 'Your first Mochi app'
slug: your-first-mochi-app
description: 'Build your first page with serverProps, selective hydration, and server islands in four steps.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Your first Mochi app

Let's build a small app that exercises every server/client boundary you'll touch in real code. We'll put together a single `/hello` page in four steps, picking up one pillar at a time: [`serverProps`](/docs/defining-routes/) for loading data on every request, and [passing props to islands](/docs/island-props/) so a server-rendered parent can hand values to a hydrated child. Then we'll add [`mochi:hydrate`](/docs/selective-hydration/) for one interactive island while the rest stays zero-JS, and [`mochi:defer`](/docs/server-islands/) for a server island that renders separately from the main request.

By the end we'll have a greeting card with a live like button and a personalized welcome that loads in after the page renders.

### Set up

You'll need [Bun installed](https://bun.com/docs/installation) (>=1.3.13). Scaffold a new project with the official CLI and pick the **minimal** template when prompted:

```sh
bun create mochi@latest my-app
# choose: minimal
cd my-app
bun install
bun run dev
```

The scaffold gives you a working app on `http://localhost:3333`. Its entry point is `src/index.ts`, which boots the server and declares your routes inline in the `Mochi.serve()` call:

```ts
// file: src/index.ts (scaffolded)
import { Mochi } from 'mochi-framework';

const PORT = Number(process.env.PORT) || 3333;

await Mochi.serve({
  port: PORT,
  development: process.env.MODE === 'development',
  routes: {
    '/': Mochi.page('./src/HelloWorld.svelte'),
  },
});
```

`src/index.ts` is the single bootstrap file — you'll edit its `routes` object next, then build the Svelte components it points at.

### Step 1 — Register the route

Now let's point `/hello` at a Svelte page and give it some data to render. Open `src/index.ts` and replace the scaffolded route inside `routes` with this one. `serverProps` is either a plain object or a `(req, params) => props` resolver — whatever it returns becomes the page component's `$props`.

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  port: Number(process.env.PORT) || 3333,
  development: process.env.MODE === 'development',
  routes: {
    '/hello': Mochi.page('./src/Hello.svelte', {
      serverProps: () => ({
        siteName: 'Mochi',
        renderedAt: new Date().toISOString(),
      }),
    }),
  },
});
```

The resolver runs on every request, so each reload produces a fresh `renderedAt`. See [Defining routes](/docs/defining-routes/) for the full `serverProps` contract and the other `Mochi.*` route helpers. (The scaffolded `src/HelloWorld.svelte` is now unused — feel free to delete it.)

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

Reload the page in dev mode and you'll see Mochi's [debug bar](/docs/debug-bar/) pinned to the bottom-right of the page. Open the **Islands** panel — `LikeButton` shows up tagged `mochi:hydrate` with the byte size of its serialized props (the `initialLikes` value), and the crosshair icon next to each row scrolls to and outlines the island on the page.

### Step 4 — A server island

Finally, let's add a personalized greeting that doesn't block the rest of the page. We marked `Visitor.svelte` with `mochi:defer` back in Step 2, so it skips the initial SSR pass — the page ships with our `<p>Loading…</p>` fallback in its place. The browser then fetches the component _in a separate request_, the server renders it, and the result swaps in.

<Callout type="tip">

The deferred island fetch is its own request, so `getRequestContext()` inside the island sees the island URL — not the page URL. Read page-specific state in the parent and forward it as a prop.

</Callout>

Update `Hello.svelte` to read `?name=` and pass it through to `Visitor`:

```svelte
<!-- file: src/Hello.svelte (updated) -->
<script lang="ts">
  import { getRequestContext } from 'mochi-framework';
  import LikeButton from './LikeButton.svelte';
  import Visitor from './Visitor.svelte';

  let { siteName, renderedAt } = $props<{ siteName: string; renderedAt: string }>();

  const { url } = getRequestContext();
  const visitorName = url.searchParams.get('name') ?? 'friend';
</script>

<h1>Welcome to {siteName}</h1>
<p>Rendered at <code>{renderedAt}</code></p>

<LikeButton mochi:hydrate initialLikes={42} />

<Visitor mochi:defer name={visitorName}>
  <p>Loading…</p>
</Visitor>
```

```svelte
<!-- file: src/Visitor.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let { name }: { name: string; children?: Snippet } = $props();
</script>

<p>Welcome back, {name}!</p>
```

`mochi:defer` lets the call site pass fallback children (our `<p>Loading…</p>`) that render in place of the island until the deferred fetch resolves. The framework handles the swap — `Visitor` itself never renders `children`, but we declare it in the prop type so TypeScript accepts the fallback at the call site.

The `name` prop rides through the same `devalue` round-trip as `initialLikes`. Try [`/docs/your-first-mochi-app/hello?name=Alice`](/docs/your-first-mochi-app/hello?name=Alice) — the main page is identical for every visitor, but the deferred fragment swaps in a personalized greeting.

<Callout type="tip">

Cookies are an exception worth knowing: the browser sends them along with the island fetch automatically, so `getRequestContext().cookies` inside a server island reads the visitor's cookies without needing the parent to forward them.

</Callout>

### See it live

The finished app is running on this site at [**/docs/your-first-mochi-app/hello**](/docs/your-first-mochi-app/hello). Click the heart, then try [`/docs/your-first-mochi-app/hello?name=Alice`](/docs/your-first-mochi-app/hello?name=Alice) to watch the deferred fragment swap in a personalized greeting. The [debug bar](/docs/debug-bar/)'s **Islands** panel groups the two islands separately: `LikeButton` under hydrated islands as `mochi:hydrate`, and `Visitor` under server islands as `mochi:defer` with a lock icon (server-island props are HMAC-signed before being sent to the client).

### What's next

- [Defining routes](/docs/defining-routes/) — `Mochi.page`, `Mochi.api`, `Mochi.ws`, `Mochi.sse`, and the full `serverProps` contract
- [Selective hydration](/docs/selective-hydration/) — `mochi:hydrate`, `islandId`, `isHydratable`
- [Lazy hydration](/docs/lazy-hydration/) — `mochi:hydrate:visible` for below-the-fold islands
- [Server islands](/docs/server-islands/) — `mochi:defer`, signed props, and `MOCHI_KEY`
- [Passing props to islands](/docs/island-props/) — every type `devalue` can round-trip
