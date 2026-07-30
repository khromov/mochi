---
title: 'Coming from SvelteKit'
slug: coming-from-sveltekit
description: 'Map each SvelteKit concept to its Mochi equivalent.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
  import ComparisonTable from './_components/ComparisonTable.svelte';
</script>

## Coming from SvelteKit

This page maps SvelteKit features to their Mochi equivalents so you can start quickly. Read the feature table first, or [skip to the feature list](#routing).

### Feature comparison

<ComparisonTable mochi:hydrate />

### Routing

SvelteKit uses a file-based router. Mochi uses a programmatic `routes` record passed to `Mochi.serve({ routes })`. Each key is a Bun router pattern. Each value is built with `Mochi.page`, `Mochi.api`, `Mochi.ws`, or `Mochi.sse`.

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/': Mochi.page('./src/Home.svelte'),
    '/posts/:slug': Mochi.page('./src/Post.svelte'),
    '/health': Mochi.api(() => Response.json({ status: 'ok' })),
  },
});
```

### Advanced routing

Mochi uses Bun router patterns: `:slug` for a required parameter, `*` for a catch-all. Validate a parameter's shape inline.

```ts
// file: src/index.ts
import { Mochi, error } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/fruits/:name': Mochi.page('./src/Fruit.svelte', {
      serverProps: ({ params }) => {
        if (params.name !== 'apple' && params.name !== 'orange') error(404, 'Unknown fruit');
        return { name: params.name };
      },
    }),
    '/files/*': Mochi.page('./src/Files.svelte'),
  },
});
```

<Callout type="tip">

Register the most specific patterns first. Bun matches in declaration order.

</Callout>

### Layouts

Mochi has no client-side router, so every navigation is a full page load. Create a wrapper component that accepts `children`, then import it from each page.

```svelte
<!-- file (Mochi): src/lib/Layout.svelte -->
<script>
  let { user, children } = $props();
</script>

<nav>Hi {user.name}</nav>
{@render children()}
```

```svelte
<!-- file (Mochi): src/Home.svelte -->
<script>
  import Layout from './lib/Layout.svelte';
  let { user, posts } = $props();
</script>

<Layout {user}>
  <h1>Posts</h1>
  {#each posts as post}
    <a href="/posts/{post.slug}">{post.title}</a>
  {/each}
</Layout>
```

Share layout data through a common helper and spread the result into each route's `serverProps`:

```ts
// file (Mochi): src/lib/baseProps.ts
export async function baseProps() {
  return { user: await loadCurrentUser() };
}
```

```ts
// file (Mochi): src/index.ts
import { Mochi } from 'mochi-framework';
import { baseProps } from './lib/baseProps';

await Mochi.serve({
  routes: {
    '/': Mochi.page('./src/Home.svelte', {
      serverProps: async () => ({ ...(await baseProps()), posts: await loadPosts() }),
    }),
  },
});
```

### Load functions

SvelteKit's `load` becomes `serverProps` on your `Mochi.page` call. It is a plain object or a `(req, params) => props` resolver (sync or async). The result reaches the component as `$props`.

```ts
// file (Mochi): src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/posts/:slug': Mochi.page('./src/Post.svelte', {
      serverProps: async (_req, params) => ({ post: await loadPost(params.slug) }),
    }),
  },
});
```

The `Mochi.page()` entry component renders on the server, so you can also call data helpers directly inside the component. You can read `getRequestContext().params` anywhere on the server instead of threading `params` through `serverProps`.

### Form actions

SvelteKit's `actions` export becomes the `actions` field on `Mochi.page`. The helpers `fail`, `redirect`, and `success` import from `mochi-framework`. A POST matches an `?/<name>` query (or `default` when absent). The action's return value populates a `form` prop on re-render.

```ts
// file (Mochi): src/index.ts
import { Mochi, fail, success, redirect } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/login': Mochi.page('./src/Login.svelte', {
      actions: {
        default: ({ formData, cookies }) => {
          const username = String(formData.get('username') ?? '');
          if (!username) return fail(400, { error: 'Username required' });
          cookies.set('user', username, { httpOnly: true, path: '/' });
          return success({ username });
        },
        logout: () => redirect(303, '/'),
      },
    }),
  },
});
```

<Callout type="tip">

When `actions` is declared, `form` is reserved for the action result. Do not return `form` from `serverProps`. See [Defining routes](/docs/defining-routes/).

</Callout>

### `use:enhance`

SvelteKit's `use:enhance` becomes Mochi's `enhance` attachment from `mochi-framework`.

```svelte
<!-- file (Mochi): src/Login.svelte -->
<script>
  import { enhance } from 'mochi-framework';
</script>

<form method="POST" action="?/login" {@attach enhance()}>
  <input name="username" />
  <button type="submit">Log in</button>
</form>
```

<Callout type="tip">

Mark the surrounding component with `mochi:hydrate*` so the attachment runs in the browser. Attachments run only when Svelte hydrates a component. See [Progressive enhancement](/docs/progressively-enhancing-forms-with-enhance/).

</Callout>

### API routes

SvelteKit's `+server.ts` becomes `Mochi.api(handler)`. One handler per route. Branch on `method` inside.

```ts
// file (Mochi): src/index.ts
import { Mochi, error } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/api/users/:id': Mochi.api(async ({ method, request, params }) => {
      if (method === 'GET') return Response.json(await loadUser(params.id));
      if (method === 'POST') return Response.json(await createUser(params.id, await request.json()));
      error(405, 'Method not allowed');
    }),
  },
});
```

### `error()`, `redirect()`, `fail()`

Same names, imported from `mochi-framework`. `error(status, message)` throws `MochiHttpError`. `redirect(status, location)` returns from an action. `fail(status, data)` and `success(data?)` round-trip through the `form` prop or the `enhance` envelope.

```ts
import { error, redirect, fail, success } from 'mochi-framework';
```

<Callout type="tip">

Call `error(status, message)` to signal an HTTP status. A bare `throw new Error()` becomes a 500.

</Callout>

### Error pages

SvelteKit's `+error.svelte` becomes the `errorPage` option on `Mochi.serve()` — one component for the whole app. It receives one `error: MochiErrorProps` prop with `status`, `message`, and `stack` (dev only).

```ts
// file (Mochi): src/index.ts
await Mochi.serve({ errorPage: './src/Error.svelte', routes });
```

```svelte
<!-- file (Mochi): src/Error.svelte -->
<script lang="ts">
  import type { MochiErrorProps } from 'mochi-framework';
  let { error }: MochiErrorProps = $props();
</script>

<h1>{error.status}</h1><p>{error.message}</p>
```

See [Error handling](/docs/error-handling/).

### Hooks (`handle`)

SvelteKit's `handle` export becomes the `handle` option on `Mochi.serve()`. The shape matches: `async ({ event, resolve }) => Response`. `event` carries `{ request, url, server, locals, kind }`. Compose handles with `sequence(...)`. Read `cookies`, `params`, and `getClientAddress()` from `getRequestContext()` inside the handler.

```ts
// file (Mochi): src/handle.ts
import type { Handle } from 'mochi-framework';

export const auth: Handle = async ({ event, resolve }) => {
  if (event.kind === 'asset') return resolve(event);
  event.locals.user = await loadUser(event.request);
  return resolve(event);
};
```

```ts
// file (Mochi): src/index.ts
import { Mochi, sequence } from 'mochi-framework';
import { auth } from './handle';

await Mochi.serve({ handle: sequence(auth), routes });
```

### `resolve` options

SvelteKit's `transformPageChunk` / `filterSerializedResponseHeaders` map to Mochi's `transformPage` / `filterResponseHeaders`. `transformPage({ html, done })` rewrites the HTML body. `filterResponseHeaders(name, value)` keeps or drops a header.

```ts
// file (Mochi): src/handle.ts
import type { Handle } from 'mochi-framework';

export const stripServer: Handle = ({ event, resolve }) =>
  resolve(event, {
    transformPage: ({ html }) => html.replace('%THEME%', 'dark'),
    filterResponseHeaders: (name) => name.toLowerCase() !== 'server',
  });
```

### `handleError`

Same name. Configure it as a `Mochi.serve()` option. The hook receives `{ error, event, status, message }` and may return `{ status, message }`, a `Response`, or `void`.

```ts
// file (Mochi): src/index.ts
import type { HandleError } from 'mochi-framework';

const handleError: HandleError = ({ error, event }) => {
  if (error) tracker.capture(error, { path: event.url.pathname });
};

await Mochi.serve({ handleError, routes });
```

<Callout type="tip">

`handleError` never runs for `Mochi.api` failures. Return an error envelope inside the handler instead.

</Callout>

### `event.locals`

Same surface. Set `event.locals.x` from middleware. Read it from any server-side code with `getRequestContext().locals`.

```ts
// file (Mochi): src/SomePage.svelte
import { getRequestContext } from 'mochi-framework';
const { locals } = getRequestContext();
```

### Observability

Mochi emits structured lifecycle events on `mochiEvents` — `request`, `ws:*`, `sse:*`, `cache:*`, `action:*`, `server:start`, `server:stop`, and compile-time events. Subscribe to feed tracing, metrics, or a custom logger.

```ts
// file (Mochi): src/index.ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.on('request', ({ method, path, status, duration }) => {
  metrics.timing('http.request', duration, { method, path, status });
});
```

See [Events](/docs/events/).

### Client IP

SvelteKit's `event.getClientAddress()` becomes a method on `getRequestContext()`. Configure `proxy.addressHeader` / `proxy.xffDepth` on `Mochi.serve()` for trusted proxy hops.

```ts
// file (Mochi): src/handle.ts
import { getRequestContext } from 'mochi-framework';
const ip = getRequestContext().getClientAddress();
```

### CSRF protection

Mochi rejects cross-origin form POSTs by default with an Origin-header check. Configure it with the `csrf` option on `Mochi.serve()`.

```ts
// file (Mochi): src/index.ts
await Mochi.serve({
  csrf: { trustedOrigins: ['https://embed.example'] },
  routes,
});
```

<Callout type="tip">

Pin trusted origins through `csrf.trustedOrigins` instead of disabling CSRF on a state-mutating endpoint.

</Callout>

### Cookies

`event.cookies` becomes `getRequestContext().cookies` (also on the form-action callback as `event.cookies`). Same `get` / `set` / `delete` API. App-wide defaults live on the `cookie:defaults` filter.

```ts
// file (Mochi): src/handle.ts
import { getRequestContext } from 'mochi-framework';

const { cookies } = getRequestContext();
cookies.set('session', token, { httpOnly: true, sameSite: 'Lax', path: '/' });
```

### `page` state

Import `url`, `params`, `cookies`, and `locals` directly from `mochi-framework`. `url` is isomorphic — it reads the request context on the server and `window.location` on the client. `params` and `locals` are server-only.

```svelte
<!-- file (Mochi): src/Some.svelte -->
<script>
  import { url, params } from 'mochi-framework';
</script>

<p>{url.pathname} — {params.slug}</p>
```

<Callout type="tip">

`url` works on server and client. Guard `params` and `locals` with `isServer`. See [Request context](/docs/request-context/).

</Callout>

### Navigation

Mochi has no client-side router. Every navigation is a full HTML round-trip. For form submissions, use `enhance()`. For anything else, set `window.location.href` or call `history.pushState` from a hydrated island.

```svelte
<!-- file (Mochi): src/SomeIsland.svelte -->
<button onclick={() => (window.location.href = '/dashboard')}>Go</button>
```

Listen for `beforeunload` or `popstate` directly.

### Link preloading

Planned. The browser handles `<a>` clicks natively today. Link preloading is on the roadmap.

### Snapshots

Mochi does full page reloads, so the browser's bfcache restores native `<input>` / `<textarea>` / scroll state on `Back` / `Forward` when the page is bfcache-eligible (no `Cache-Control: no-store`, no unfinished requests). For component state that must survive a hard reload, write to `sessionStorage` from a hydrated island.

```svelte
<!-- file (Mochi): src/Comment.svelte (hydrated island) -->
<script>
  let comment = $state(sessionStorage.getItem('comment') ?? '');
  $effect(() => sessionStorage.setItem('comment', comment));
</script>

<textarea bind:value={comment}></textarea>
```

### Shallow routing

Call `history.pushState` / `history.replaceState` directly from a hydrated island. Store the value alongside the URL or in component state.

```svelte
<!-- file (Mochi): src/PhotoGrid.svelte -->
<button onclick={() => history.pushState({ modal: 'open' }, '', location.href)}>Open</button>
```

### Service workers

Planned. Register one yourself from a hydrated island if you need offline support today.

```ts
// file (Mochi): src/Boot.svelte (hydrated island)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
```

### Image optimization

Import local images Vite-style. The import returns `{ src, width, height, format }` and copies the file to a content-hashed URL. Declare transforms once as [named sizes](/docs/images/) on `Mochi.serve()`. Transforms run on demand behind an encrypted URL, cached to disk with stale-while-revalidate. `<Image>` also works for remote sources. `placeholder` adds a ThumbHash blur-up with no client JavaScript.

```svelte
<!-- file (Mochi): src/Home.svelte -->
<script>
  import { Image } from 'mochi-framework/image';
  import hero from './hero.png';
</script>

<Image src={hero} size="hero" alt="Hero" />
```

### Remote functions

Mochi has no built-in RPC. Use `Mochi.api(handler)` with a hand-rolled `fetch()`, or `Mochi.page` actions with `enhance()` for form-driven mutations.

```ts
// file (Mochi): src/index.ts
import { Mochi, error } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/api/like/:id': Mochi.api(async ({ method, params }) => {
      if (method !== 'POST') error(405, 'POST only');
      await db.sql`UPDATE item SET likes = likes + 1 WHERE id = ${params.id}`;
      return Response.json({ ok: true });
    }),
  },
});
// on the client: await fetch(`/api/like/${id}`, { method: 'POST' })
```

### Environment variables

Bun auto-loads `.env`. Read everything through `process.env.FOO`. The `mochi` virtual module (`isServer`, `isBrowser`, `isDev`) covers SSR-only / browser-only branching.

```ts
// Mochi
const apiKey = process.env.API_KEY;
const publicApiUrl = process.env.PUBLIC_API_URL;
```

<Callout type="tip">

Bun loads `.env` for you. To send an environment variable to the client, pass it as a prop to a hydrated island.

</Callout>

### Paths

Write your app links as absolute paths (`/about`). The `assetPrefix` option on `Mochi.serve()` rewrites the URL prefix for framework-internal bundles only (default `/_mochi`).

### Server-only modules

The `.server.ts` suffix carries over. Apply it per file anywhere in your source tree. Every export of a `*.server.ts` file is unavailable on the client, so the real module compiles for SSR only.

```ts
// file (Mochi): src/lib/db.server.ts
import { Database } from 'bun:sqlite';
export const db = new Database(':memory:');
```

```svelte
<!-- file (Mochi): src/FactCard.svelte — hydratable island -->
<script>
  import { hydratable } from 'svelte';
  import { db } from './lib/db.server.ts';

  const version = await hydratable('app:sqlite-version', () => db.query('SELECT sqlite_version() as v').get().v);
</script>

<p>SQLite {version}</p>
```

### `$lib`

Add the path to `tsconfig.json` if you want the alias.

```json
// file (Mochi): tsconfig.json
{
  "compilerOptions": {
    "paths": { "$lib/*": ["./src/lib/*"] }
  }
}
```

### Page options

Mochi always renders on the server. Client-side JavaScript is opt-in per component with `mochi:hydrate`, `mochi:hydrate:visible`, `mochi:defer`, or `mochi:defer:visible`. Set the trailing-slash policy globally with `trailingSlash: 'never' | 'always'` on `Mochi.serve()`. See [Trailing slash](/docs/trailing-slash/).

```ts
// file (Mochi): src/index.ts
await Mochi.serve({ trailingSlash: 'always', routes });
// hydration is per-component: <Counter mochi:hydrate /> in the page
```

### Streaming / deferred data

Stream slow work with `mochi:defer` server islands. The deferred component renders out-of-band and swaps in once ready. Its fallback children stay visible until then.

```svelte
<!-- file (Mochi): src/Home.svelte -->
<SlowRecommendations mochi:defer>
  <p>Loading…</p>
</SlowRecommendations>
```

See [Server islands](/docs/server-islands/).

### Adapters

Mochi targets Bun through `Bun.serve()`. Containerize the Bun runtime or deploy to a supported serverless platform. See [Deployment](/docs/deployment-options/).

### `vite.config.ts`

Mochi uses Bun's bundler and Svelte 5's compiler. Pass preprocessors through the `compile:preprocessors` filter. Tweak the compiler in `svelte.config.js` (auto-loaded; override with the `svelteConfigPath` option). See [Svelte config](/docs/svelte-config/).

```js
// file (Mochi): svelte.config.js
export default {
  compilerOptions: { runes: true },
};
```

### See also

- [Defining routes](/docs/defining-routes/) — the four `Mochi.*` route helpers.
- [Middleware (hooks)](/docs/middleware/) — `Handle`, `sequence`, `resolve` options.
- [Error handling](/docs/error-handling/) — `errorPage`, `handleError`, API error envelope.
- [Server islands](/docs/server-islands/) — `mochi:defer` and deferred rendering.
- [Hydratable values](/docs/hydratable/) — `hydratable(key, fn)`.
- [Extensions](/docs/extensions/) — `eventHooks` and `filters`.
- [Events](/docs/events/) — the `mochiEvents` bus.
- [Cache](/docs/cache/) — `MochiCache` SWR caching.
- [Trailing slash](/docs/trailing-slash/) — global `trailingSlash` policy.

<SeeItInAction
demos={[
{ href: "/demos/server-props/", title: "Server Props", hook: "How server props work — pass fresh per-request data into a page via serverProps on Mochi.page()." },
{ href: "/demos/login/", title: "Form Actions", hook: "How form actions work — a form rendered twice, as a plain HTML POST and intercepted with {@attach enhance(...)}." },
{ href: "/demos/api/", title: "API Endpoints", hook: "How API routes work — define JSON endpoints with Mochi.api(), tested live against the running server." },
]}
/>
