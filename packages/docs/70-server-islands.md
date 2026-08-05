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

Like all islands, a deferred component must be statically imported from a relative `.svelte`/`.md`/`.svx` path — package imports or props-passed components are a compile error. See `Supported import forms` under `Selective hydration`.

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
2. Props are serialized with `devalue`, encrypted, and stamped onto the element as `signed-props`.
3. On `connectedCallback`, the element fetches `/_mochi/island/{ComponentName}?props={token}` (the `/_mochi` prefix follows `assetPrefix`).
4. The server decrypts the props, renders the component, and returns the HTML.
5. The HTML replaces the fallback inside the custom element.

Failed fetches are retried with exponential backoff (default 5 retries, 1s–10s); pass `mochi:defer={{ retries: 10 }}` to override.

<Callout type="info">

`mochi-framework build` precompiles every server island into the manifest as a standalone SSR module, so production renders them from the prebuilt bundle. The first `mochi:defer` fetch never triggers an on-demand compile at runtime.

</Callout>

### Combining with hydration

Apply `mochi:hydrate` alongside `mochi:defer` to fetch the island on-demand and then hydrate it for client-side interactivity:

```svelte
<ShoppingCart mochi:defer mochi:hydrate items={initialItems} />
```

<Callout type="warning">

**Adding `mochi:hydrate` makes the props client-visible.** A pure `mochi:defer` island's props never leave the server in plaintext — the token on the wire is opaque ciphertext and the endpoint returns only rendered HTML. But hydration needs the raw props on the client, so `mochi:defer mochi:hydrate` echoes the decrypted props back as plaintext (exactly like any [hydratable island](/docs/island-props/)). Don't pass server-only secrets to an island you also hydrate. The choice is sealed inside the token, not the URL — appending `?hydrate=` to a defer-only token can't force the endpoint to reveal its props.

</Callout>

### Nesting islands inside a server island

A server island's content is itself a full render, so it may contain `mochi:hydrate` islands and further `mochi:defer` server islands.

```svelte
<!-- file: src/Dashboard.svelte (rendered via mochi:defer) -->
<Chart mochi:hydrate {data} />
<Notifications mochi:defer />
```

Nested `mochi:defer` islands are **inlined into the parent's fetch**: when the island endpoint renders `Dashboard`, it renders `Notifications` in-process too, so one request returns the whole chain no matter how deep it nests. The decision happens at render time — a nested island inside `{#if}`/`{#each}` inlines exactly when its branch renders, with the same props the placeholder would have sealed, so nothing unreachable is ever rendered. If an inlined child throws, it degrades to a fetch placeholder and fetches (and fails) on its own, leaving the parent's content intact. Recursion is capped at 32 inline expansions per request; past the cap, children fall back to fetching.

Opt out per call site to keep a child on its own fetch (useful when a slow child shouldn't delay the parent's content), or globally:

```svelte
<Notifications mochi:defer={{ inline: false }} />
```

```ts
Mochi.serve({ inlineNestedIslands: false });
```

`mochi:defer:visible` children are always exempt — laziness is their point, so they keep their own viewport-triggered fetch.

CSS for nested islands is delivered with the fetched HTML (the host page can't link it ahead of time, since the content isn't rendered until the island resolves), so styles apply as soon as the island appears.

<Callout type="warning">

**`mochi:defer` inside a hydratable subtree is a compile error.** A component marked `mochi:hydrate*` or `mochi:clientOnly` re-renders on the client, where a server island cannot exist. Remove `mochi:defer` from the child (it already renders as part of the parent's island fetch), or the hydrate directive from the parent.

</Callout>

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

Props are serialized with `devalue` — see [Passing props to islands](/docs/island-props/) for the full list of supported types. Server islands additionally encrypt the payload (authenticated encryption) and pass it as a query parameter; if the encrypted props exceed URL length limits (~1800 bytes), a warning is emitted. The island's component name is bound as authenticated data, so a props token sealed for one island can't be replayed against another.

<Callout type="warning">

**Fetch data inside islands, not through props.** Large data blobs passed as props inflate the encrypted URL until it trips a runtime warning. Use `getRequestContext()` inside the island component to fetch data server-side instead.

</Callout>

<Callout type="warning">

**Treat server-island rendering as idempotent — never trigger mutable actions from it.** Tokens are encrypted, not single-use: once a client has seen a given prop permutation, it can re-fetch that island any number of times. Encryption stops clients from _forging_ new permutations, not from _replaying_ ones they've already received. So a side effect inside the component (incrementing a counter, charging an account, sending an email) will fire again on every replay.

</Callout>

Do **NOT** ship large blobs through server-island props; instead, fetch the data inside the component using `getRequestContext()`. Instead, fetch any data you need inside the island and send only identifiers such as ids as props to minimize the payload over the network. Prop URLs over 1800 chars trigger a runtime warning.

### Encryption key

Props are encrypted with a key derived (HMAC-SHA512) from `process.env.MOCHI_KEY` (base64url-encoded, any length). If `MOCHI_KEY` is unset, Mochi generates a random key and logs a warning — fine for local dev, broken across restarts and multi-instance deploys.

```sh
# .env
MOCHI_KEY=<base64url-encoded 32-byte secret>
```

Generate one and write it to `.env` with [`mochi-framework generate-key`](/docs/cli/#generate-key):

```sh
bunx mochi-framework generate-key
```

<Callout type="warning">

**Set `MOCHI_KEY` for any deployment that runs more than one process or survives restarts.** Without a shared key, tokens minted by one instance won't decrypt on another and deferred islands will fail to load after a restart or rolling deploy.

</Callout>

<Callout type="danger">

**Never commit `MOCHI_KEY`.** It signs server-island prop URLs; leaking it lets attackers forge them. Supply it via your platform's secret store and generate one with `bunx mochi-framework generate-key`.

</Callout>

<SeeItInAction
demos={[
{ href: "/demos/server-island/", title: "Server Islands", hook: "How server islands work — components marked mochi:defer render server-side on demand after the initial page is delivered." },
{ href: "/demos/nested-islands/", title: "Nested Islands", hook: "How nested islands work — a mochi:defer server island wrapping mochi:hydrate components, and server islands nesting more server islands." },
{ href: "/demos/lazy-server-island/", title: "Lazy Server Islands", hook: "How lazy server islands work — server islands marked mochi:defer:visible only fetch when the wrapper scrolls into view." },
]}
/>
