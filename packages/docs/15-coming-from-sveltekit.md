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

```
// SvelteKit
src/routes/+page.svelte              → /
src/routes/posts/[slug]/+page.svelte → /posts/:slug
src/routes/health/+server.ts         → /health
```

```ts
// file (Mochi): src/index.ts
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

Mochi uses Bun router patterns: `:slug` for a required parameter, `*` for a catch-all. There is no SvelteKit-style `[[optional]]` segment, no `[param=matcher]` syntax, and no `src/params/` directory. Validate a parameter's shape inline.

```ts
// file (SvelteKit): src/params/fruit.ts
export function match(param: string): param is 'apple' | 'orange' {
  return param === 'apple' || param === 'orange';
}
// then: src/routes/fruits/[name=fruit]/+page.svelte
```

```ts
// file (Mochi): src/index.ts
import { Mochi, error } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/fruits/:name': Mochi.page('./src/Fruit.svelte', {
      serverProps: (_req, params) => {
        if (params.name !== 'apple' && params.name !== 'orange') error(404, 'Unknown fruit');
        return { name: params.name };
      },
    }),
    '/files/*': Mochi.page('./src/Files.svelte'),
  },
});
```

A `:param` always captures the whole segment — you can't put literal text beside it. SvelteKit's `profile/@[user]` has no direct equivalent: Bun treats `@:user` as literal text, so `/profile/@:user` never matches. Match `/profile/:user` instead — the param captures the whole segment, sigil included (`params.user === '@bob'`) — and note it _also_ matches `/profile/bob`, silently serving the page at two URLs unless you guard:

```ts
// file (Mochi): the SvelteKit route profile/@[user]
'/profile/:user': Mochi.page('./src/Profile.svelte', {
  serverProps: (_req, params) => {
    if (!params.user.startsWith('@')) error(404); // /profile/bob must not alias /profile/@bob
    return { username: params.user.slice(1) };
  },
}),
```

<Callout type="tip">

Register the most specific patterns first. Bun matches in declaration order.

</Callout>

### Layouts

SvelteKit's `+layout.svelte` / `+layout.server.ts` have no Mochi equivalent. In SvelteKit, layouts persist across navigations: the client-side router keeps the layout component mounted and only swaps the page slot. That also lets `+layout.server.ts` skip refetching data that is still valid. Mochi has no client-side router, so every navigation is a full page load. There is no component tree to persist and no data to revalidate selectively.

Instead, create a wrapper component that accepts `children`, then import it from each page.

```svelte
<!-- file (SvelteKit): src/routes/+layout.svelte -->
<script>
  let { data, children } = $props();
</script>

<nav>Hi {data.user.name}</nav>
{@render children()}
```

```svelte
<!-- file (Mochi): src/lib/Layout.svelte -->
<script>
  let { user, children } = $props();
</script>

<nav>Hi {user.name}</nav>
{@render children()}
```

There is nothing special about the layout — it is a plain component. SvelteKit applies it for you; in Mochi you import it into the page and wrap the markup yourself:

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

<Callout type="warning">

The layout wrapper renders `{@render children()}`, so it can never be a `mochi:hydrate*` island — children cannot cross the server→client boundary, and the directive is a [compile error](/docs/selective-hydration/#no-children-on-hydrate-islands). Keep the layout server-rendered and mark the interactive components inside it.

</Callout>

Share the data that SvelteKit's `+layout.server.ts` would have loaded through a common helper, then spread the result into each route's `serverProps`:

```ts
// file (SvelteKit): src/routes/+layout.server.ts
export async function load() {
  return { user: await loadCurrentUser() };
}
```

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

<Callout type="tip">

Every page that shares a shell imports the layout component explicitly. There is no automatic nesting. This is more verbose than SvelteKit, but it makes the component tree visible at each call site.

</Callout>

### Load functions

SvelteKit's `load` becomes `serverProps` on your `Mochi.page` call. It is a plain object or a `(req, params) => props` resolver (sync or async). The result reaches the component as `$props`.

```ts
// file (SvelteKit): src/routes/posts/[slug]/+page.server.ts
export async function load({ params }) {
  return { post: await loadPost(params.slug) };
}
```

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

```svelte
<!-- file (Mochi): src/Post.svelte -->
<script>
  let { post } = $props();
</script>

<h1>{post.title}</h1>
```

The `Mochi.page()` entry component renders on the server, so you can also call data helpers directly inside the component instead of threading every value through props. Client-side interactivity is opt-in per child component with `mochi:hydrate`, `mochi:hydrate:visible`, `mochi:defer`, or `mochi:defer:visible`.

You can read `getRequestContext().params` anywhere on the server instead of threading `params` through `serverProps`.

A guard redirect inside `load` ports directly: return `redirect(status, location)` from `serverProps` and the page render is skipped (see [Redirecting from serverProps](/docs/defining-routes/#redirecting-from-serverprops); requires mochi-framework 0.10.0).

```ts
serverProps: (req) => {
  if (!currentUser(req)) return redirect(303, '/login');
  return { settings: loadSettings() };
},
```

### Form actions

SvelteKit's `actions` export becomes the `actions` field on `Mochi.page`. The helpers `fail`, `redirect`, and `success` import from `mochi-framework`. A POST matches an `?/<name>` query (or `default` when absent). The action's return value populates a `form` prop on re-render. The action callback receives `{ request, url, server, locals, kind, method, formData, actionName, cookies, params }`.

```ts
// file (SvelteKit): src/routes/login/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';

export const actions = {
  default: async ({ request }) => {
    const formData = await request.formData();
    const username = String(formData.get('username') ?? '');
    if (!username) return fail(400, { error: 'Username required' });
    return { username };
  },
  logout: () => redirect(303, '/'),
};
```

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

```svelte
<!-- file (Mochi): src/Login.svelte -->
<script>
  let { form } = $props();
</script>

{#if form?.data?.error}<p>{form.data.error}</p>{/if}
```

<Callout type="warning">

**`form.data`, not `form`.** SvelteKit spreads the `fail()` payload onto the `form` prop itself; Mochi nests it — `form = { ok, action, status?, data }`. Every `form?.error` read in ported code must become `form?.data?.error`, or the value is silently `undefined`.

</Callout>

<Callout type="tip">

When `actions` is declared, `form` is reserved for the action result. Do not return `form` from `serverProps`. See [Defining routes](/docs/defining-routes/).

</Callout>

### `use:enhance`

SvelteKit's `use:enhance` becomes Mochi's `enhance` attachment from `mochi-framework`. The wire format and `submit` callback semantics match closely — `MochiEnhanceResult` mirrors SvelteKit's `ActionResult`.

```svelte
<!-- file (SvelteKit): src/routes/login/+page.svelte -->
<script>
  import { enhance } from '$app/forms';
</script>

<form method="POST" action="?/login" use:enhance>
  <input name="username" />
  <button type="submit">Log in</button>
</form>
```

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

### API routes (`+server.ts`)

SvelteKit's `+server.ts` with `GET` / `POST` exports becomes `Mochi.api(handler)`. One handler per route. Branch on `method` inside. The handler receives `{ request, url, server, locals, kind, method, params, cookies }`.

```ts
// file (SvelteKit): src/routes/api/users/[id]/+server.ts
export async function GET({ params }) {
  return Response.json(await loadUser(params.id));
}

export async function POST({ params, request }) {
  return Response.json(await createUser(params.id, await request.json()));
}
```

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

<Callout type="tip">

Use `Mochi.page` for normal HTML routes. `Mochi.api` never goes through the error page or `handleError`. See [API routes](/docs/api-routes/).

</Callout>

### `error()`, `redirect()`, `fail()`

Same names, imported from `mochi-framework`. `error(status, message?)` throws `MochiHttpError`, defaulting the message to the canonical status text when omitted. `redirect(status, location)` returns from an action or a `serverProps` resolver. `fail(status, data)` and `success(data?)` round-trip through the `form` prop (under `form.data`) or the `enhance` envelope.

```ts
// SvelteKit
import { error, redirect, fail } from '@sveltejs/kit';
```

```ts
// Mochi
import { error, redirect, fail, success } from 'mochi-framework';
```

<Callout type="tip">

Call `error(status, message)` to signal an HTTP status. A bare `throw new Error()` becomes a 500.

</Callout>

### Error pages (`+error.svelte`)

SvelteKit's `+error.svelte` becomes the `errorPage` option on `Mochi.serve()` — one component for the whole app, defaulting to `DefaultError.svelte`. It receives one `error: MochiErrorProps` prop with `status`, `message`, and `stack` (dev only).

```svelte
<!-- file (SvelteKit): src/routes/+error.svelte -->
<script>
  import { page } from '$app/state';
</script>

<h1>{page.status}</h1><p>{page.error.message}</p>
```

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

SvelteKit's `hooks.server.ts` `handle` export becomes the `handle` option on `Mochi.serve()`. The shape matches: `async ({ event, resolve }) => Response`. `event` carries `{ request, url, server, locals, kind }`. Compose handles with `sequence(...)`. Unlike SvelteKit, `event` itself does not carry `cookies`, `params`, or `getClientAddress` — read those from `getRequestContext()` inside the handler.

```ts
// file (SvelteKit): src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = await loadUser(event.request);
  return resolve(event);
};
```

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

SvelteKit's `resolve(event, { transformPageChunk, filterSerializedResponseHeaders })` maps to Mochi's `resolve(event, { transformPage, filterResponseHeaders })`. `transformPage({ html, done })` rewrites the HTML body. `filterResponseHeaders(name, value)` keeps or drops a header.

```ts
// file (SvelteKit): src/hooks.server.ts
export const handle = ({ event, resolve }) =>
  resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%THEME%', 'dark'),
    filterSerializedResponseHeaders: (name) => name.toLowerCase() !== 'server',
  });
```

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
// file (SvelteKit): src/hooks.server.ts
import type { HandleServerError } from '@sveltejs/kit';

export const handleError: HandleServerError = ({ error, event }) => {
  tracker.capture(error, { path: event.url.pathname });
  return { message: 'Internal error' };
};
```

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
// file (SvelteKit): src/routes/profile/+page.server.ts
export const load = ({ locals }) => ({ user: locals.user });
```

```ts
// file (Mochi): src/SomePage.svelte
import { getRequestContext } from 'mochi-framework';
const { locals } = getRequestContext();
```

### Observability

SvelteKit's experimental OpenTelemetry tracing has no direct equivalent. Mochi emits structured lifecycle events on `mochiEvents` — `request`, `ws:*`, `sse:*`, `cache:*`, `action:*`, `server:start`, `server:stop`, and compile-time events. Subscribe to feed tracing, metrics, or a custom logger.

```js
// file (SvelteKit): svelte.config.js
export default {
  kit: { experimental: { tracing: { server: true }, instrumentation: { server: true } } },
};
// then write OTel setup in src/instrumentation.server.ts
```

```ts
// file (Mochi): src/index.ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.on('request', ({ method, path, status, duration }) => {
  metrics.timing('http.request', duration, { method, path, status });
});
```

`consoleLogger()` is the default subscriber for human-readable output. See [Events](/docs/events/).

### Client IP (`getClientAddress`)

SvelteKit's `event.getClientAddress()` becomes a method on `getRequestContext()`. Configure `proxy.addressHeader` / `proxy.xffDepth` on `Mochi.serve()` for trusted reverse-proxy hops.

```ts
// file (SvelteKit): src/routes/api/whoami/+server.ts
export const GET = ({ getClientAddress }) => new Response(getClientAddress());
```

```ts
// file (Mochi): src/handle.ts
import { getRequestContext } from 'mochi-framework';
const ip = getRequestContext().getClientAddress();
```

<Callout type="tip">

Set `proxy.xffDepth` so `getClientAddress()` picks the correct hop, instead of parsing `X-Forwarded-For` yourself.

</Callout>

### CSRF protection

Like SvelteKit, Mochi rejects cross-origin form POSTs by default. It checks the Origin header on `POST` / `PUT` / `PATCH` / `DELETE` when the body is a form content type. Configure it with the `csrf` option on `Mochi.serve()` and the `csrf:trustedOrigins`, `csrf:protectedMethods`, `csrf:formContentTypes`, and `csrf:check` filters.

```js
// file (SvelteKit): svelte.config.js
export default {
  kit: { csrf: { checkOrigin: true } }, // default
};
```

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

`event.cookies` becomes `getRequestContext().cookies` (also on the form-action callback as `event.cookies`). Same `get` / `set` / `delete` API and `CookieSerializeOptions`. App-wide defaults live on the `cookie:defaults` filter rather than per call.

```ts
// file (SvelteKit): src/routes/login/+page.server.ts
export const actions = {
  default: ({ cookies }) => {
    cookies.set('session', token, { httpOnly: true, sameSite: 'lax', path: '/' });
  },
};
```

```ts
// file (Mochi): src/handle.ts
import { getRequestContext } from 'mochi-framework';

const { cookies } = getRequestContext();
cookies.set('session', token, { httpOnly: true, sameSite: 'Lax', path: '/' });
```

### `$app/state` and the `page` store

There is no reactive `page` store. Import `url`, `params`, `cookies`, and `locals` directly from `mochi-framework`. `url` is isomorphic — it reads the request context on the server and `window.location` on the client. `params` and `locals` are server-only.

```svelte
<!-- file (SvelteKit): src/routes/+page.svelte -->
<script>
  import { page } from '$app/state';
</script>

<p>{page.url.pathname} — {page.params.slug}</p>
```

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

### `$app/navigation` (`goto`, `invalidate`, `preloadData`)

No equivalent. Mochi has no client-side router, so there is nothing to `goto` into and nothing to `invalidate`. Every navigation is a full HTML round-trip. For form submissions, use `enhance()`. For anything else, set `window.location.href` or call `history.pushState` from a hydrated island.

```svelte
<!-- file (SvelteKit): src/routes/+page.svelte -->
<script>
  import { goto, invalidateAll } from '$app/navigation';
</script>

<button onclick={() => goto('/dashboard')}>Go</button>
<button onclick={() => invalidateAll()}>Refresh</button>
```

```svelte
<!-- file (Mochi): src/SomeIsland.svelte -->
<button onclick={() => (window.location.href = '/dashboard')}>Go</button>
```

<Callout type="tip">

Listen for `beforeunload` or `popstate` directly. There is no `beforeNavigate` / `afterNavigate` / `onNavigate`.

</Callout>

### Link options (`data-sveltekit-preload-*`)

Planned, but not yet available. Mochi has no client router today, so there is nothing to preload code or data into. The browser handles `<a>` clicks natively, and link preloading is on the roadmap. `data-sveltekit-reload`, `data-sveltekit-replacestate`, `data-sveltekit-keepfocus`, and `data-sveltekit-noscroll` likewise have no Mochi attribute.

```html
<!-- SvelteKit -->
<body data-sveltekit-preload-data="hover">
  <a href="/about">About</a>
</body>
```

```html
<!-- Mochi -->
<a href="/about">About</a>
```

### Snapshots

No equivalent. SvelteKit's `snapshot` exists because its client router reuses page components across navigation. Mochi does full page reloads, so the browser's bfcache restores native `<input>` / `<textarea>` / scroll state on `Back` / `Forward` when the page is bfcache-eligible (no `Cache-Control: no-store`, no unfinished requests). For component state, or anything that must survive forward navigation or a hard reload, write to `sessionStorage` from a hydrated island, or use a cookie or query parameter.

```svelte
<!-- file (SvelteKit): src/routes/comment/+page.svelte -->
<script>
  let comment = $state('');
  export const snapshot = {
    capture: () => comment,
    restore: (v) => (comment = v),
  };
</script>

<textarea bind:value={comment}></textarea>
```

```svelte
<!-- file (Mochi): src/Comment.svelte (hydrated island) -->
<script>
  let comment = $state(sessionStorage.getItem('comment') ?? '');
  $effect(() => sessionStorage.setItem('comment', comment));
</script>

<textarea bind:value={comment}></textarea>
```

### Shallow routing (`pushState` / `replaceState`)

No framework helper. Call `history.pushState` / `history.replaceState` directly from a hydrated island. There is no `page.state` to read back, so store the value alongside the URL or in component state.

```svelte
<!-- file (SvelteKit): src/routes/photos/+page.svelte -->
<script>
  import { pushState } from '$app/navigation';
  import { page } from '$app/state';
</script>

<button onclick={() => pushState('', { modal: 'open' })}>Open</button>
{#if page.state.modal}<Modal />{/if}
```

```svelte
<!-- file (Mochi): src/PhotoGrid.svelte -->
<button onclick={() => history.pushState({ modal: 'open' }, '', location.href)}>Open</button>
```

### Service workers

Planned, but not yet available. There is no `src/service-worker.ts` convention and no `$service-worker` virtual module. Built-in service worker integration is on the roadmap. Register one yourself from a hydrated island if you need offline support today.

```ts
// file (SvelteKit): src/service-worker.ts
import { build, files, version } from '$service-worker';
const ASSETS = `cache-${version}`;
// install / fetch handlers …
```

```ts
// file (Mochi): src/Boot.svelte (hydrated island)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
// then ship /public/sw.js yourself
```

### Image optimization (`@sveltejs/enhanced-img`)

Supported, with a different split of the work. SvelteKit optimizes at build time through `@sveltejs/enhanced-img`, with runtime transformations available at extra cost through a CDN. Mochi imports local images the same Vite-style way — the import returns `{ src, width, height, format }` and copies the file to a content-hashed URL. Declare the transforms once as [named sizes](/docs/images/) on `Mochi.serve()`. They run on demand in `Bun.Image` behind an encrypted URL, cached to disk with stale-while-revalidate. The same `<Image>` works for remote sources, and `placeholder` adds a ThumbHash blur-up with no client JavaScript.

```svelte
<!-- file (SvelteKit): src/routes/+page.svelte -->
<script>
  import hero from './hero.png?enhanced';
</script>

<enhanced:img src={hero} alt="Hero" />
```

```svelte
<!-- file (Mochi): src/Home.svelte — `hero` size declared in Mochi.serve({ image: { sizes } }) -->
<script>
  import { Image } from 'mochi-framework/image';
  import hero from './hero.png';
</script>

<Image src={hero} size="hero" alt="Hero" />
```

### Remote functions

No equivalent. SvelteKit's type-safe `query` / `command` RPC has no built-in counterpart. Use `Mochi.api(handler)` with a hand-rolled `fetch()`, or `Mochi.page` actions with `enhance()` for form-driven mutations.

```ts
// file (SvelteKit): src/routes/likes.remote.ts
import * as v from 'valibot';
import { command } from '$app/server';

export const addLike = command(v.string(), async (id) => {
  await db.sql`UPDATE item SET likes = likes + 1 WHERE id = ${id}`;
});
```

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

### `$env/static/*` and `$env/dynamic/*`

None of these virtual modules exist. Bun auto-loads `.env`, so read everything through `process.env.FOO`. The `mochi` virtual module (`isServer`, `isBrowser`, `isDev`) covers the SSR-only / browser-only branching that `$env/static/private` solved with import-time errors.

```ts
// SvelteKit
import { API_KEY } from '$env/static/private';
import { PUBLIC_API_URL } from '$env/static/public';
```

```ts
// Mochi
const apiKey = process.env.API_KEY;
const publicApiUrl = process.env.PUBLIC_API_URL;
```

<Callout type="tip">

Bun loads `.env` for you. To send an environment variable to the client, pass it as a prop to a hydrated island.

</Callout>

### `$app/paths` (`asset`, `base`, `resolve`)

No equivalent. Mochi does not support sub-path deployments through configuration. Write your app links as absolute paths (`/about`). The `assetPrefix` option on `Mochi.serve()` rewrites the URL prefix for framework-internal bundles only (default `/_mochi`), not for your own routes or static files.

```svelte
<!-- SvelteKit -->
<script>
  import { asset, base } from '$app/paths';
</script>

<a href="{base}/about">About</a>
<img src={asset('/logo.png')} />
```

```svelte
<!-- Mochi -->
<a href="/about">About</a>
<img src="/logo.png" />
```

### Server-only modules

SvelteKit's `.server.ts` suffix carries over — Mochi uses the same convention. There is no `$lib/server` directory equivalent. The suffix is the entire mechanism, applied per file anywhere in your source tree. Every named and default export of a `*.server.ts` file is replaced with a throwing `Proxy` on the client, so the real module body compiles for SSR only.

```ts
// file (SvelteKit): src/lib/server/db.ts
import { Database } from 'better-sqlite3';
export const db = new Database(':memory:');
```

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

No virtual `$lib` alias. Add the path to `tsconfig.json` if you want the same ergonomic.

```svelte
<!-- SvelteKit (works out of the box) -->
<script>
  import Button from '$lib/Button.svelte';
</script>
```

```json
// file (Mochi): tsconfig.json
{
  "compilerOptions": {
    "paths": { "$lib/*": ["./src/lib/*"] }
  }
}
```

### Page options (`ssr`, `csr`, `prerender`)

Not configurable per page. Mochi always renders on the server. Client-side JavaScript is opt-in per component with `mochi:hydrate`, `mochi:hydrate:visible`, `mochi:defer`, or `mochi:defer:visible`. There is no prerender / SSG mode — every request renders fresh.

Trailing-slash policy is global, not per page. Set `trailingSlash: 'never' | 'always'` on `Mochi.serve()` and Mochi registers both forms, then redirects to the canonical one. See [Trailing slash](/docs/trailing-slash/).

```ts
// file (SvelteKit): src/routes/about/+page.ts
export const prerender = true;
export const csr = false;
export const trailingSlash = 'always';
```

```ts
// file (Mochi): src/index.ts
await Mochi.serve({ trailingSlash: 'always', routes });
// hydration is per-component: <Counter mochi:hydrate /> in the page
```

<Callout type="tip">

Control hydration with the `mochi:hydrate*` directives at each call site. There is no per-page `ssr` / `csr` / `prerender` export.

</Callout>

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

Mochi uses Bun's bundler and Svelte 5's compiler. Pass preprocessors through the `compile:preprocessors` filter. Tweak the compiler in `svelte.config.js`, which loads automatically (override it with the `svelteConfigPath` option). See [Svelte config](/docs/svelte-config/).

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
