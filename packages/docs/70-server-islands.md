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

Mark a component with `mochi:defer` to skip it during the initial SSR pass and render it on demand from a dedicated endpoint after the page loads. Use it for personalized fragments such as avatars and cart counts that would otherwise block the surrounding HTML from being cached.

```svelte
<!-- file: src/Page.svelte -->
<UserAvatar mochi:defer userId={123} />
```

Children of a deferred component become the fallback shown until the island resolves.

```svelte
<UserAvatar mochi:defer userId={123}>
  <div class="skeleton">Loading...</div>
</UserAvatar>
```

Import a deferred component statically from a relative `.svelte` / `.md` / `.svx` path. See [Supported import forms](/docs/selective-hydration/#supported-import-forms).

A server island is a normal Svelte component with full access to the request context through `getRequestContext()`. Cookies are forwarded automatically because the fetch is same-origin.

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

1. SSR emits a `<mochi-server-island>` custom element holding the fallback content. The component does not render yet.
2. Mochi serializes props with `devalue`, encrypts them, and stamps them onto the element as `signed-props`.
3. On `connectedCallback`, the element fetches `/_mochi/island/{ComponentName}?props={token}` (the `/_mochi` prefix follows `assetPrefix`).
4. The server decrypts the props, renders the component, and returns the HTML.
5. The HTML replaces the fallback inside the custom element.

Mochi retries a failed fetch with exponential backoff (default 5 retries, 1s–10s). Pass `mochi:defer={{ retries: 10 }}` to override.

<Callout type="info">

`mochi-framework build` precompiles every server island into the manifest as a standalone SSR module, so production renders them from the prebuilt bundle.

</Callout>

### Combining with hydration

Apply `mochi:hydrate` alongside `mochi:defer` to fetch the island on demand and then hydrate it for client-side interactivity.

```svelte
<ShoppingCart mochi:defer mochi:hydrate items={initialItems} />
```

<Callout type="warning">

**Adding `mochi:hydrate` makes the props client-visible.** A pure `mochi:defer` island keeps its props on the server — the token on the wire is opaque ciphertext and the endpoint returns only HTML. Hydration needs the raw props on the client, so `mochi:defer mochi:hydrate` echoes the decrypted props back as plaintext. Do not pass server-only secrets to an island you also hydrate.

</Callout>

### Nesting islands inside a server island

A server island's content is a full render, so it can contain `mochi:hydrate` islands and further `mochi:defer` server islands. Hydratable children hydrate once the deferred HTML lands. Nested server islands fetch themselves.

```svelte
<!-- file: src/Dashboard.svelte (rendered via mochi:defer) -->
<Chart mochi:hydrate {data} />
<Notifications mochi:defer />
```

Mochi delivers CSS for nested hydratable islands with the fetched HTML, so styles apply as soon as the island appears.

### Lazy server islands with `mochi:defer:visible`

Defer the fetch until the wrapper scrolls into view, mirroring [`mochi:hydrate:visible`](/docs/lazy-hydration/).

```svelte
<UserAvatar mochi:defer:visible={{ rootMargin: '200px' }} userId={123}>
  <div class="skeleton">Loading...</div>
</UserAvatar>
```

Combine `rootMargin` and `retries`: `mochi:defer:visible={{ rootMargin: '200px', retries: 10 }}`. Combine with `mochi:hydrate` for interactive lazy islands. Provide fallback children so the user has something to scroll past while waiting.

### Props

Mochi serializes props with `devalue` — see [Passing props to islands](/docs/island-props/). Server islands also encrypt the payload and pass it as a query parameter. The island's component name is bound as authenticated data, so a token sealed for one island cannot be replayed against another.

<Callout type="warning">

**Fetch data inside the island, not through props.** Large props inflate the encrypted URL until it trips a runtime warning at ~1800 characters. Use `getRequestContext()` inside the island to fetch data server-side, and pass only identifiers such as ids as props.

</Callout>

<Callout type="warning">

**Treat server-island rendering as idempotent. Never trigger mutable actions from it.** Tokens are encrypted, not single-use. Once a client has seen a prop permutation, it can re-fetch that island any number of times. A side effect inside the component — incrementing a counter, charging an account, sending an email — fires again on every replay.

</Callout>

### Encryption key

Mochi encrypts props with a key derived (HMAC-SHA512) from `process.env.MOCHI_KEY` (base64url-encoded, any length). Without `MOCHI_KEY`, Mochi generates a random key and logs a warning — fine for local dev, broken across restarts and multi-instance deploys.

Generate a key and write it to `.env`:

```sh
bunx mochi-framework generate-key
```

<Callout type="warning">

**Set `MOCHI_KEY` for any deployment that runs more than one process or survives restarts.** Without a shared key, tokens minted by one instance fail to decrypt on another, and deferred islands fail to load after a restart or rolling deploy.

</Callout>

<Callout type="danger">

**Never commit `MOCHI_KEY`.** It signs server-island prop URLs. A leak lets attackers forge them. Supply it through your platform's secret store.

</Callout>

<SeeItInAction
demos={[
{ href: "/demos/server-island/", title: "Server Islands", hook: "mochi:defer components render on demand after the page ships." },
{ href: "/demos/nested-islands/", title: "Nested Islands", hook: "A mochi:defer island wrapping mochi:hydrate components and more server islands." },
{ href: "/demos/lazy-server-island/", title: "Lazy Server Islands", hook: "mochi:defer:visible islands fetch only when scrolled into view." },
]}
/>
