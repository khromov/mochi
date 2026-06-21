---
title: 'Coming from SvelteKit'
slug: coming-from-sveltekit
description: 'A mapping of SvelteKit concepts to their Mochi equivalents for developers switching frameworks.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Coming from SvelteKit

You have likely already been using SvelteKit as your main framework for Svelte. Here is a quick list of most of the SvelteKit features and how they map to equivalent concepts in Mochi, so you can be up and running quickly.

### Routing

SvelteKit's file-based router (`src/routes/foo/+page.svelte`) is replaced by a programmatic routes record passed to `Mochi.serve({ routes })`. Each pattern is a Bun router string; each value is built with `Mochi.page`, `Mochi.api`, `Mochi.ws`, or `Mochi.sse`.

```
// SvelteKit
src/routes/+page.svelte           → /
src/routes/posts/[slug]/+page.svelte → /posts/:slug
src/routes/health/+server.ts      → /health
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

Mochi uses Bun's router patterns — `:slug` for required params, `*` for catch-all. There is no SvelteKit-style `[[optional]]` segment, no `[param=matcher]` syntax, and no `src/params/` directory. Validate the shape of a parameter inline.

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

Register the most specific patterns first — Bun matches in declaration order, not by file-name sort.

</Callout>

### Layouts

SvelteKit's `+layout.svelte` / `+layout.server.ts` have no Mochi equivalent. In SvelteKit, layouts persist across navigations — the client-side router keeps the layout component mounted and only swaps the page slot, which also lets `+layout.server.ts` skip refetching data that hasn't been invalidated. Mochi has no client-side router, so every navigation is a full page load; there is no component tree to persist and no data to selectively revalidate.

Instead, create a wrapper component that accepts `children`, and import it from each page.

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

In SvelteKit, `+layout.svelte` wraps `+page.svelte` automatically. In Mochi, the page must import and wrap itself:

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

Share data that SvelteKit's `+layout.server.ts` would have loaded via a common helper, and spread the result into each route's `serverProps`:

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

Every page that shares a shell imports the layout component explicitly — there is no automatic nesting. This is more verbose than SvelteKit, but makes the component tree visible at each call site.

</Callout>

### Load functions

SvelteKit's `load` export becomes `serverProps` on your `Mochi.page` call. It's either a plain object or a `(req, params) => props` resolver (sync or async); the result is passed to the component as `$props`.

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
<!-- file: src/Post.svelte -->
<script>
  let { post } = $props();
</script>

<h1>{post.title}</h1>
```

The main component used with Mochi.page() renders on the server, so you can also call data helpers directly inside the component instead of threading every value through props. Client-side interactivity is opt-in per child component via `mochi:hydrate`, `mochi:hydrate:visible`, `mochi:defer`, or `mochi:defer:visible`.

You don't need to thread `params` through `serverProps`; instead, you can call `getRequestContext().params` directly anywhere on the server.

### Form actions

SvelteKit's `actions` export becomes the `actions` field on `Mochi.page`. The helpers are named the same: `fail`, `redirect`, `success`, imported from `mochi-framework`. POST submissions match an `?/<name>` query (or `default` when absent), and the action's return value populates a `form` prop on re-render. The action callback receives `{ request, url, server, locals, kind, method, formData, actionName, cookies, params }`.

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
<!-- file: src/Login.svelte -->
<script>
  let { form } = $props();
</script>

{#if form?.error}<p>{form.error}</p>{/if}
```

<Callout type="tip">

When `actions` is declared, leave `form` reserved for the action result — don't return it from `serverProps`. See [Defining routes](/docs/defining-routes/).

</Callout>

### `use:enhance`

SvelteKit's `use:enhance` action becomes Mochi's `enhance` attachment from `mochi-framework`. The wire format and `submit` callback semantics match closely (`MochiEnhanceResult` mirrors SvelteKit's `ActionResult`).

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

Mark the surrounding component with `mochi:hydrate*` so the attachment can attach in the browser — attachments can only run when Svelte hydrates a component. See [Progressively enhancing forms with enhance](/docs/progressively-enhancing-forms-with-enhance/).

</Callout>

### API routes (`+server.ts`)

SvelteKit's `+server.ts` with `GET` / `POST` exports becomes `Mochi.api(handler)` — one handler per route, branch on `method` inside. The handler receives `{ request, url, server, locals, kind, method, params, cookies }`.

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

Use `Mochi.page` for normal HTML routes — `Mochi.api` never goes through the error page or `handleError`. See [API routes](/docs/api-routes/).

</Callout>

### `error()`, `redirect()`, `fail()`

Same names, imported from `mochi-framework`. `error(status, message)` throws `MochiHttpError`; `redirect(status, location)` returns from an action; `fail(status, data)` and `success(data?)` round-trip via the `form` prop or the `enhance` envelope.

```ts
// SvelteKit
import { error, redirect, fail } from '@sveltejs/kit';
```

```ts
// Mochi
import { error, redirect, fail, success } from 'mochi-framework';
```

<Callout type="tip">

Call `error(status, message)` to signal an HTTP status — a bare `throw new Error()` becomes a 500.

</Callout>

### Error pages (`+error.svelte`)

SvelteKit's `+error.svelte` becomes the `errorPage` option on `Mochi.serve()` — a single component for the whole app (defaults to `DefaultError.svelte`). The component receives a single `error: MochiErrorProps` prop with `status`, `message`, and `stack` (dev only).

```svelte
<!-- file (SvelteKit): src/routes/+error.svelte -->
<script>
  import { page } from '$app/state';
</script>

<h1>{page.status}</h1><p>{page.error.message}</p>
```

```ts
// file (Mochi): src/index.ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  errorPage: './src/Error.svelte',
  routes: {
    '/': Mochi.page('./src/Home.svelte'),
  },
});
```

```svelte
<!-- file (Mochi): src/Error.svelte -->
<script lang="ts">
  import type { MochiErrorProps } from 'mochi-framework';
  let { error }: MochiErrorProps = $props();
</script>

<h1>{error.status}</h1><p>{error.message}</p>
```

See also [Error handling](/docs/error-handling/).

### Hooks (`handle`)

SvelteKit's `hooks.server.ts` `handle` export becomes the `handle` option on `Mochi.serve()`. The shape matches: `async ({ event, resolve }) => Response`, `event` carries `{ request, url, server, locals, kind }`, and `sequence(...handles)` composes them. Unlike SvelteKit, `event` itself does not carry `cookies`, `params`, or `getClientAddress` — read those from `getRequestContext()` inside the handler.

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

<Callout type="tip">

Wrap multiple handles in `sequence()` — `handle` takes a single function. See [Middleware (hooks)](/docs/middleware/).

</Callout>

### `resolve` options

SvelteKit's `resolve(event, { transformPageChunk, filterSerializedResponseHeaders })` maps to Mochi's `resolve(event, { transformPage, filterResponseHeaders })`. `transformPage({ html, done })` rewrites the HTML body; `filterResponseHeaders(name, value)` keeps or drops a header.

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

Same name. Configure as a `Mochi.serve()` option; the hook receives `{ error, event, status, message }` and may return `{ status, message }`, a `Response`, or `void`.

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

`handleError` is never called for `Mochi.api` failures — return an error envelope inside the handler instead.

</Callout>

### `event.locals`

Same surface. Set `event.locals.x` from middleware; read it from any server-side code via `getRequestContext().locals`.

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

SvelteKit's experimental OpenTelemetry tracing has no direct equivalent. Instead, Mochi emits structured lifecycle events through `mochiEvents` — `request`, `ws:*`, `sse:*`, `cache:*`, `action:*`, `server:start`, `server:stop`, and the compile-time events. Subscribe to hook tracing, metrics, or a custom logger in front of them.

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

Like SvelteKit, Mochi rejects cross-origin form POSTs by default (Origin header check on `POST`/`PUT`/`PATCH`/`DELETE` when the body is a form content type). Configure via the `csrf` option on `Mochi.serve()` and the `csrf:trustedOrigins`, `csrf:protectedMethods`, `csrf:formContentTypes`, `csrf:check` filters.

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

Pin trusted origins via `csrf.trustedOrigins` or the `csrf:trustedOrigins` filter instead of disabling CSRF on a state-mutating endpoint.

</Callout>

### Cookies

`event.cookies` becomes `getRequestContext().cookies` (also surfaced on the form-action callback as `event.cookies`). Same `get` / `set` / `delete` API and `CookieSerializeOptions`. App-wide defaults live on the `cookie:defaults` filter rather than per-call.

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

There is no reactive `page` store. Instead, import `url`, `params`, `cookies`, and `locals` directly from `mochi-framework`. `url` is isomorphic — it reads from the request context on the server and from `window.location` on the client. `params` and `locals` are server-only.

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

`url` works on both server and client — no need to branch on environment. `params` and `locals` are server-only; guard them with `isServer` if needed. See [Request context](/docs/request-context/).

</Callout>

### `$app/navigation` (`goto`, `invalidate`, `preloadData`)

No equivalent. Mochi has no client-side router, so there is nothing to `goto` into and nothing to `invalidate` — every navigation is a full HTML round-trip. For form submissions, use `enhance()`; for anything else, set `window.location.href` or call `history.pushState` from a hydrated island.

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

Listen for `beforeunload` or `popstate` directly — there is no `beforeNavigate` / `afterNavigate` / `onNavigate`.

</Callout>

### Link options (`data-sveltekit-preload-*`)

No equivalent. There is no client router to preload code or data into — the browser handles `<a>` clicks natively. `data-sveltekit-reload`, `data-sveltekit-replacestate`, `data-sveltekit-keepfocus`, and `data-sveltekit-noscroll` likewise have no Mochi attribute.

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

No equivalent. SvelteKit's `snapshot` exists because its client router reuses page components across navigation; Mochi does full-page reloads, so the browser's bfcache restores native `<input>` / `<textarea>` / scroll state on `Back` / `Forward` when the page is bfcache-eligible (no `Cache-Control: no-store`, no unfinished requests). For component state, or anything that must survive forward navigation or a hard reload, write to `sessionStorage` from a hydrated island, or use a cookie / query param.

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

No framework helper. Call `history.pushState` / `history.replaceState` directly from a hydrated island; there is no `page.state` to read back, so store the value alongside the URL or in component state.

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

No equivalent. There is no `src/service-worker.ts` convention and no `$service-worker` virtual module. Register one yourself from a hydrated island if you need offline support.

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

### Remote functions

No equivalent. SvelteKit's type-safe `query` / `command` RPC has no built-in counterpart. The closest patterns are `Mochi.api(handler)` + hand-rolled `fetch()` for arbitrary calls, or `Mochi.page` actions + `enhance()` for form-driven mutations.

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
// then on the client: await fetch(`/api/like/${id}`, { method: 'POST' })
```

### `$env/static/*` and `$env/dynamic/*`

None of these virtual modules exist. Bun auto-loads `.env`; read everything via `process.env.FOO`. The `mochi` virtual module (`isServer`, `isBrowser`, `isDev`) covers the SSR-only / browser-only branching that `$env/static/private` solved by import-time errors.

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

Rely on Bun's built-in `.env` loading — no need for `dotenv`. If you need to beam an environment variable to the client, pass it as a prop to a hydrated island.

</Callout>

### `$app/paths` (`asset`, `base`, `resolve`)

No equivalent. Mochi does not support sub-path deployments via configuration — write your app links as absolute paths (`/about`). The `assetPrefix` option on `Mochi.serve()` only rewrites the URL prefix for framework-internal bundles (default `/_mochi`), not for your own routes or static files.

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

SvelteKit's `.server.ts` suffix carries over — Mochi uses the same convention. There is no `$lib/server` directory equivalent; the suffix is the entire mechanism, applied per-file anywhere in your source tree. Every named and default export of a `*.server.ts` file is replaced with a throwing `Proxy` on the client, so the real module body is only compiled for SSR.

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

Not configurable per page. Mochi always renders on the server; client-side JavaScript is opt-in per component via `mochi:hydrate`, `mochi:hydrate:visible`, `mochi:defer`, or `mochi:defer:visible`. There is no prerender / SSG mode — every request renders fresh.

Trailing-slash policy is global, not per-page: set `trailingSlash: 'never' | 'always'` on `Mochi.serve()` and Mochi registers both forms and redirects to the canonical one. See [Trailing slash](/docs/trailing-slash/).

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

Control hydration with the `mochi:hydrate*` directives at each call site — there is no per-page `ssr` / `csr` / `prerender` export.

</Callout>

### Streaming / deferred data

SvelteKit's pattern of returning promises from `load` to stream after the shell is replaced by `mochi:defer` server islands. The deferred component renders out-of-band against `${assetPrefix}/island/:componentName` (default `/_mochi/island/:componentName`) and swaps in once ready; its fallback children stay visible until then.

```ts
// file (SvelteKit): src/routes/+page.server.ts
export const load = () => ({
  streamed: { recommendations: slowFetchRecommendations() },
});
```

```svelte
<!-- file (SvelteKit): src/routes/+page.svelte -->
<script>
  let { data } = $props();
</script>

{#await data.streamed.recommendations}
  <p>Loading…</p>
{:then recs}
  <ul>
    {#each recs as r}<li>{r.title}</li>{/each}
  </ul>
{/await}
```

```svelte
<!-- file (Mochi): src/Home.svelte -->
<SlowRecommendations mochi:defer>
  <p>Loading…</p>
</SlowRecommendations>
```

See [Server islands](/docs/server-islands/).

### Adapters

There is no adapter abstraction in Mochi. Instead, Mochi uses the bun standard `Bun.serve()` router - Bun is the only target. Containerise the Bun runtime or use a supported serverless platform to deploy.

### `vite.config.ts`

Mochi does not use Vite. It compiles `.svelte` via Bun's own bundler using Svelte 5's compiler internally. Pass preprocessors through the `compile:preprocessors` filter; tweak the compiler via a `svelte.config.js` (Mochi auto-loads `./svelte.config.js`, override with the `svelteConfigPath` option). See [Svelte config](/docs/svelte-config/).

```ts
// file (SvelteKit): vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
export default defineConfig({ plugins: [sveltekit()] });
```

```js
// file (Mochi): svelte.config.js
export default {
  compilerOptions: { runes: true },
};
```

```ts
// file (Mochi): src/index.ts
await Mochi.serve({
  filters: { 'compile:preprocessors': () => [vitePreprocess()] },
  routes,
});
```

### See also

- [Defining routes](/docs/defining-routes/) — the four `Mochi.*` route helpers.
- [Middleware (hooks)](/docs/middleware/) — `Handle`, `sequence`, `resolve` options.
- [Error handling](/docs/error-handling/) — `errorPage`, `handleError`, API error envelope.
- [Error boundaries](/docs/error-boundaries/) — auto-wrapped islands and `<mochi-island-failure>`.
- [Server islands](/docs/server-islands/) — `mochi:defer` and deferred rendering.
- [Hydratable values](/docs/hydratable/) — `hydratable(key, fn)` SSR→client value reuse.
- [Extensions (hooks & filters)](/docs/extensions/) — `eventHooks` and `filters`.
- [Events](/docs/events/) — `mochiEvents` lifecycle bus for observability and logging.
- [Cache](/docs/cache/) — `MochiCache` SWR caching for arbitrary computations.
- [Trailing slash](/docs/trailing-slash/) — global `trailingSlash` policy on `Mochi.serve()`.

<SeeItInAction
  demos={[
    { href: "/demos/server-props/", title: "Server Props", hook: "Define serverProps on Mochi.page() to pass fresh data into a Svelte page on every request." },
    { href: "/demos/login/", title: "Form Actions", hook: "A login form rendered twice — plain HTML POST and intercepted with {@attach enhance(...)}." },
    { href: "/demos/api/", title: "API Endpoints", hook: "JSON routes defined with Mochi.api(), tested live against the running server." },
  ]}
/>
