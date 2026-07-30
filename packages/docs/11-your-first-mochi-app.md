---
title: 'Your first Mochi app'
slug: your-first-mochi-app
description: 'Build a page with serverProps, selective hydration, and a server island in four steps.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Your first Mochi app

Let's build a small app that exercises every server/client boundary you'll touch in real code. We'll put together a single `/hello` page in four steps, picking up one concept at a time: [`serverProps`](/docs/defining-routes/) to load data on every request, [passing props to islands](/docs/island-props/) so a server-rendered parent can hand values to a hydrated child, [`mochi:hydrate`](/docs/selective-hydration/) for one interactive island while the rest stays zero-JS, and [`mochi:defer`](/docs/server-islands/) for a server island that renders separately from the main request.

By the end we'll have a greeting card with a live like button and a personalized welcome that loads in after the page renders.

### Set up

Install [Bun](https://bun.com/docs/installation) (>=1.3.14). Scaffold a project with the official CLI and pick the **minimal** template when prompted:

```sh
bun create mochi@latest my-app
# choose: minimal
cd my-app
bun install
bun run dev
```

The scaffold gives you a working app on `http://localhost:3333`. The entry point is `src/index.ts`. It boots the server and declares routes inline in the `Mochi.serve()` call:

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

`src/index.ts` is the single bootstrap file. You'll edit its `routes` object next, then build the components it points at.

### Step 1 — Register the route

Now let's point `/hello` at a Svelte page and give it some data. Open `src/index.ts` and replace the scaffolded route with this one. `serverProps` is a plain object or a `(req, params) => props` resolver. Its return value becomes the page's `$props`.

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

The resolver runs on every request, so each reload produces a fresh `renderedAt`. See [Defining routes](/docs/defining-routes/) for the full `serverProps` contract. You can delete the now-unused `src/HelloWorld.svelte`.

### Step 2 — The page component

Next, let's write the page itself. Every `Mochi.page()` entry component is server-only. `Hello.svelte` reads the `serverProps`, renders a static layout, and mounts the two child islands we'll build next. Notice that this file ships zero JavaScript even though it imports two components that do — the `mochi:` directive at each render site decides what hydrates.

```svelte
<!-- file: src/Hello.svelte -->
<script lang="ts">
  import LikeButton from './LikeButton.svelte';
  import Visitor from './Visitor.svelte';

  let { siteName, renderedAt }: { siteName: string; renderedAt: string } = $props();
</script>

<h1>Welcome to {siteName}</h1>
<p>Rendered at <code>{renderedAt}</code></p>

<LikeButton mochi:hydrate initialLikes={42} />

<Visitor mochi:defer>
  <p>Loading…</p>
</Visitor>
```

The `initialLikes={42}` value crosses the server→client boundary. Mochi serializes island props with [`devalue`](/docs/island-props/), so `Date`, `Map`, `Set`, `BigInt`, and cyclic references all survive the trip.

<Callout type="warning">

Island props are serialized into the HTML payload, so the client can read them. Never pass secrets, API keys, or session tokens as island props.

</Callout>

### Step 3 — A hydrated island

Now let's give the user something to click! `LikeButton.svelte` is a normal Svelte 5 component. We accept `initialLikes` as a prop, keep a `$state` counter, and bump it on click.

```svelte
<!-- file: src/LikeButton.svelte -->
<script lang="ts">
  let { initialLikes }: { initialLikes: number } = $props();
  let likes = $state(initialLikes);
</script>

<button onclick={() => likes++}>♥ {likes}</button>
```

<Callout type="tip">

The `mochi:hydrate` directive lives **at the render site** in `Hello.svelte`, not inside the island. The same component can render statically elsewhere.

</Callout>

Reload the page in dev mode and you'll see Mochi's [debug bar](/docs/debug-bar/) pinned to the bottom-right. Open the **Islands** panel — `LikeButton` shows up tagged `mochi:hydrate` with the byte size of its serialized props. Click the crosshair icon next to a row to scroll to and outline the island.

### Step 4 — A server island

Finally, let's add a personalized greeting that doesn't block the rest of the page. We marked `Visitor.svelte` with `mochi:defer` back in Step 2, so it skips the initial SSR pass — the page ships with our `<p>Loading…</p>` fallback in its place. The browser then fetches the component in a separate request, the server renders it, and the result swaps in.

<Callout type="tip">

The deferred fetch is its own request, so `getRequestContext()` inside the island sees the island URL, not the page URL. Read page-specific state in the parent and forward it as a prop.

</Callout>

Update `Hello.svelte` to read `?name=` and pass it through to `Visitor`:

```svelte
<!-- file: src/Hello.svelte (updated) -->
<script lang="ts">
  import { getRequestContext } from 'mochi-framework';
  import LikeButton from './LikeButton.svelte';
  import Visitor from './Visitor.svelte';

  let { siteName, renderedAt }: { siteName: string; renderedAt: string } = $props();

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

`mochi:defer` lets the call site pass fallback children. Our `<p>Loading…</p>` renders until the deferred fetch resolves, then the framework swaps in the island. `Visitor` never renders `children` itself, but we declare the type so TypeScript accepts the fallback at the call site.

The `name` prop rides the same `devalue` round-trip as `initialLikes`. Try [`/docs/your-first-mochi-app/hello/?name=Alice`](/docs/your-first-mochi-app/hello/?name=Alice) — the main page is identical for every visitor, but the deferred fragment swaps in a personalized greeting.

<Callout type="tip">

Cookies are an exception worth knowing. The browser sends them along with the island fetch, so `getRequestContext().cookies` inside a server island reads the visitor's cookies without the parent forwarding them.

</Callout>

### See it live

The finished app is running on this site at [**/docs/your-first-mochi-app/hello/**](/docs/your-first-mochi-app/hello/). Click the heart, then try [`?name=Alice`](/docs/your-first-mochi-app/hello/?name=Alice) to watch the deferred fragment swap in. The [debug bar](/docs/debug-bar/)'s **Islands** panel groups the two islands: `LikeButton` under hydrated islands, and `Visitor` under server islands with a lock icon (server-island props are encrypted before they reach the client).

### What's next

- [Defining routes](/docs/defining-routes/) — `Mochi.page`, `Mochi.api`, `Mochi.ws`, `Mochi.sse`, and `serverProps`.
- [Selective hydration](/docs/selective-hydration/) — `mochi:hydrate`, `isHydratable()`, `$props.id()`.
- [Lazy hydration](/docs/lazy-hydration/) — `mochi:hydrate:visible` for below-the-fold islands.
- [Server islands](/docs/server-islands/) — `mochi:defer`, encrypted props, and `MOCHI_KEY`.
- [Passing props to islands](/docs/island-props/) — every type `devalue` supports.

<SeeItInAction
demos={[
{ href: "/demos/hello-world/", title: "Hello World", hook: "How server-side rendering works — a Mochi.page() renders Svelte on the server and ships zero JavaScript." },
{ href: "/demos/server-props/", title: "Server Props", hook: "How server props work — pass fresh per-request data into a page via serverProps on Mochi.page()." },
]}
/>
