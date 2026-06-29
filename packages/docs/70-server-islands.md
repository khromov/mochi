---
title: 'Server islands with mochi:defer'
slug: server-islands
description: 'Render components after initial page load by fetching their HTML from the server with mochi:defer.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Server islands with `mochi:defer`

Mark a component with `mochi:defer` to skip it during the initial SSR pass and render it on-demand from a dedicated endpoint after the page loads. Use this for personalized fragments (avatars, cart counts) that would otherwise block the surrounding HTML from being cached.

```svelte
<!-- file: src/Page.svelte -->
<UserAvatar mochi:defer userId={123} />
```

Children of a deferred component become the fallback shown until the island resolves:

```svelte
<UserAvatar mochi:defer userId={123}>
  <div class="skeleton">Loading...</div>
</UserAvatar>
```

Server island components are normal Svelte components with full access to the request context via `getRequestContext()` — cookies are forwarded automatically because the fetch is same-origin.

```svelte
<!-- file: src/UserAvatar.svelte -->
<script>
  import { getRequestContext } from 'mochi-framework';
  const { cookies } = getRequestContext();
  const session = cookies.get('session');
</script>

<p>Welcome back, {userName}!</p>
```

### Fetch flow

1. SSR emits a `<mochi-server-island>` custom element holding the fallback content; the component itself is **not** rendered.
2. Props are serialized with `devalue`, HMAC-signed, and stamped onto the element as `signed-props`.
3. On `connectedCallback`, the element fetches `/_mochi/island/{ComponentName}?props={signedProps}` (the `/_mochi` prefix follows `assetPrefix`).
4. The server verifies the signature, decodes the props, renders the component, and returns the HTML.
5. The HTML replaces the fallback inside the custom element.

Failed fetches are retried with exponential backoff (default 5 retries, 1s–10s); pass `mochi:defer={{ retries: 10 }}` to override.

### Combining with hydration

Apply `mochi:hydrate` alongside `mochi:defer` to fetch the island on-demand and then hydrate it for client-side interactivity:

```svelte
<ShoppingCart mochi:defer mochi:hydrate items={initialItems} />
```

### Nesting islands inside a server island

A server island's content is itself a full render, so it may contain `mochi:hydrate` islands and further `mochi:defer` server islands. Each nested island behaves normally — hydratable children hydrate once the deferred HTML lands, and nested server islands fetch themselves.

```svelte
<!-- file: src/Dashboard.svelte (rendered via mochi:defer) -->
<Chart mochi:hydrate {data} />
<Notifications mochi:defer />
```

CSS for nested hydratable islands is delivered with the fetched HTML (the host page can't link it ahead of time, since the content isn't rendered until the island resolves), so styles apply as soon as the island appears.

### Lazy server islands with `mochi:defer:visible`

Defer the _fetch_ until the wrapper scrolls into view, mirroring [`mochi:hydrate:visible`](/docs/lazy-hydration/):

```svelte
<UserAvatar mochi:defer:visible userId={123}>
  <div class="skeleton">Loading...</div>
</UserAvatar>

<UserAvatar mochi:defer:visible={{ rootMargin: '200px' }} userId={123} />
```

Pass `rootMargin` to start fetching before the island enters the viewport. `rootMargin` and `retries` can be combined: `mochi:defer:visible={{ rootMargin: '200px', retries: 10 }}`. Combinable with `mochi:hydrate` / `mochi:hydrate:visible` for interactive lazy islands.

Provide fallback children when using `:visible` so the user has something to scroll past while waiting.

### Props

Props are serialized with `devalue` — see [Passing props to islands](/docs/island-props/) for the full list of supported types. Server islands additionally HMAC-sign the payload and pass it as a query parameter; if the signed props exceed URL length limits (~1800 bytes), a warning is emitted.

<Callout type="warning">

**Fetch data inside islands, not through props.** Large data blobs passed as props inflate the signed URL until it trips a runtime warning. Use `getRequestContext()` inside the island component to fetch data server-side instead.

</Callout>

### Signing key

Props are signed with a 32-byte key resolved at startup from `process.env.MOCHI_KEY` (base64url-encoded). If `MOCHI_KEY` is unset, Mochi generates a random key and logs a warning — fine for local dev, broken across restarts and multi-instance deploys.

```sh
# .env
MOCHI_KEY=<base64url-encoded 32-byte secret>
```

Generate one and write it to `.env` with [`mochi-framework generate-key`](/docs/cli#generate-key):

```sh
bunx mochi-framework generate-key
```

<Callout type="warning">

**Set `MOCHI_KEY` for any deployment that runs more than one process or survives restarts.** Without a shared key, signatures minted by one instance won't verify on another and deferred islands will fail to load after a restart or rolling deploy.

</Callout>

<Callout type="danger">

**Never commit `MOCHI_KEY`.** It signs server-island prop URLs; leaking it lets attackers forge them. Supply it via your platform's secret store and generate one with `bunx mochi-framework generate-key`.

</Callout>

<SeeItInAction
demos={[
{ href: "/demos/server-island/", title: "Server Islands", hook: "Components marked mochi:defer render server-side on demand after the initial page is delivered." },
{ href: "/demos/nested-islands/", title: "Nested Islands", hook: "Islands inside islands — a mochi:defer server island wrapping mochi:hydrate components, and a server island nesting more server islands." },
{ href: "/demos/lazy-server-island/", title: "Lazy Server Islands", hook: "Server islands marked mochi:defer:visible only fetch when the wrapper scrolls into view." },
]}
/>
