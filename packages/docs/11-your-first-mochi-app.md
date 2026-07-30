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

Build a small app that crosses every server/client boundary you meet in real code. You build one `/hello` page in four steps. Each step adds one concept: [`serverProps`](/docs/defining-routes/) to load data per request, [island props](/docs/island-props/) to pass values from a server-rendered parent to a hydrated child, [`mochi:hydrate`](/docs/selective-hydration/) for one interactive island, and [`mochi:defer`](/docs/server-islands/) for a server island that renders separately from the main request.

The result is a greeting card with a live like button and a personalized welcome that loads in after the page renders.

### Set up

Install [Bun](https://bun.com/docs/installation) (>=1.3.14). Scaffold a project with the official CLI and pick the **minimal** template:

```sh
bun create mochi@latest my-app
# choose: minimal
cd my-app
bun install
bun run dev
```

The app runs on `http://localhost:3333`. The entry point is `src/index.ts`. It boots the server and declares routes inline in the `Mochi.serve()` call:

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

`src/index.ts` is the single bootstrap file. Edit its `routes` object, then build the components it points at.

### Step 1 — Register the route

Point `/hello` at a Svelte page and give it data. Open `src/index.ts` and replace the scaffolded route with this one. `serverProps` is a plain object or a `(req, params) => props` resolver. Its return value becomes the page's `$props`.

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

Write `Hello.svelte`. Every `Mochi.page()` entry component is server-only. It reads `serverProps`, renders a static layout, and mounts two child islands. This file ships zero JavaScript even though it imports two components that ship JavaScript. The `mochi:` directive at each render site decides what hydrates.

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

The `initialLikes={42}` value crosses the server→client boundary. Mochi serializes island props with [`devalue`](/docs/island-props/), so `Date`, `Map`, `Set`, `BigInt`, and cyclic references survive the trip.

<Callout type="warning">

Island props are serialized into the HTML payload, so the client can read them. Never pass secrets, API keys, or session tokens as island props.

</Callout>

### Step 3 — A hydrated island

Give the user something to click. `LikeButton.svelte` is a normal Svelte 5 component. It reads `initialLikes`, keeps a `$state` counter, and increments on click.

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

Reload the page in dev mode. The [debug bar](/docs/debug-bar/) pins to the bottom-right. Open the **Islands** panel. `LikeButton` appears tagged `mochi:hydrate` with the byte size of its serialized props. Click the crosshair icon to scroll to and outline the island.

### Step 4 — A server island

Add a personalized greeting that does not block the rest of the page. `Visitor.svelte` carries `mochi:defer` from Step 2, so it skips the initial SSR pass. The page ships with the `<p>Loading…</p>` fallback in its place. The browser then fetches the component in a separate request, the server renders it, and the result swaps in.

<Callout type="tip">

The deferred fetch is its own request. Inside the island, `getRequestContext()` sees the island URL, not the page URL. Read page-specific state in the parent and forward it as a prop.

</Callout>

Update `Hello.svelte` to read `?name=` and pass it to `Visitor`:

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

`mochi:defer` lets the call site pass fallback children. The `<p>Loading…</p>` renders until the deferred fetch resolves. The framework handles the swap. `Visitor` never renders `children`, but you declare the type so TypeScript accepts the fallback at the call site.

The `name` prop rides the same `devalue` round-trip as `initialLikes`. Open [`/docs/your-first-mochi-app/hello/?name=Alice`](/docs/your-first-mochi-app/hello/?name=Alice). The main page is identical for every visitor. The deferred fragment swaps in a personalized greeting.

<Callout type="tip">

Cookies are an exception. The browser sends them with the island fetch, so `getRequestContext().cookies` inside a server island reads the visitor's cookies without the parent forwarding them.

</Callout>

### See it live

The finished app runs at [**/docs/your-first-mochi-app/hello/**](/docs/your-first-mochi-app/hello/). Click the heart, then open [`?name=Alice`](/docs/your-first-mochi-app/hello/?name=Alice) to watch the deferred fragment swap in. The [debug bar](/docs/debug-bar/) **Islands** panel groups the two islands: `LikeButton` under hydrated islands, `Visitor` under server islands with a lock icon (server-island props are encrypted before they reach the client).

### What's next

- [Defining routes](/docs/defining-routes/) — `Mochi.page`, `Mochi.api`, `Mochi.ws`, `Mochi.sse`, and `serverProps`.
- [Selective hydration](/docs/selective-hydration/) — `mochi:hydrate`, `isHydratable()`, `$props.id()`.
- [Lazy hydration](/docs/lazy-hydration/) — `mochi:hydrate:visible` for below-the-fold islands.
- [Server islands](/docs/server-islands/) — `mochi:defer`, encrypted props, and `MOCHI_KEY`.
- [Passing props to islands](/docs/island-props/) — every type `devalue` supports.

<SeeItInAction
demos={[
{ href: "/demos/hello-world/", title: "Hello World", hook: "A Mochi.page() renders Svelte on the server and ships zero JavaScript." },
{ href: "/demos/server-props/", title: "Server Props", hook: "Pass fresh per-request data into a page with serverProps." },
]}
/>
