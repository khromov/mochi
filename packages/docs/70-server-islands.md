---
title: 'Server islands with mochi:defer'
slug: server-islands
description: 'Render components after initial page load by fetching their HTML from the server with mochi:defer.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
  import VersionNote from './_components/VersionNote.svelte';
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
<script lang="ts">
  import { getRequestContext } from 'mochi-framework';

  const { cookies } = getRequestContext();
  const userName = cookies.get('user') ?? 'friend';
</script>

<p>Welcome back, {userName}!</p>
```

### How it renders

The page ships with the fallback in place of the island, plus an encrypted token carrying the island's props. The browser then fetches the rendered HTML from a per-island endpoint under `assetPrefix` (default `/_mochi/island/...`), and Mochi swaps it in over the fallback. A failed fetch retries with exponential backoff (default 9 retries, 1s–5s). Pass `mochi:defer={{ retries: 10 }}` to override.

<Callout type="info">

`mochi-framework build` precompiles every server island, so production renders them from the prebuilt bundle instead of compiling on first fetch.

</Callout>

### Combining with hydration

Apply `mochi:hydrate` alongside `mochi:defer` to fetch the island on demand and then hydrate it for client-side interactivity.

```svelte
<ShoppingCart mochi:defer mochi:hydrate items={initialItems} />
```

<Callout type="warning">

**Adding `mochi:hydrate` makes the props client-visible.** A pure `mochi:defer` island keeps its props on the server — the token on the wire is opaque and the endpoint returns only HTML. Hydration needs the raw props on the client, so `mochi:defer mochi:hydrate` echoes the decrypted props back as plaintext. Do not pass server-only secrets to an island you also hydrate.

</Callout>

### Reloading an island with `reloadDeferredIsland`

<VersionNote since="0.10.0" message="Named defers and reloadDeferredIsland were added in 0.10.0." />

Give a defer a `name`, then re-fetch its server HTML from the browser by calling `reloadDeferredIsland(name)`. Use it to refresh server-rendered content after a mutation without a full page reload.

```svelte
<Cart mochi:defer={{ name: 'cart' }}>
  <div class="skeleton">Loading...</div>
</Cart>
```

```ts
import { reloadDeferredIsland, reloadDeferredIslandAll } from 'mochi-framework';

await reloadDeferredIsland('cart'); // re-fetches, resolves once swapped in
await reloadDeferredIslandAll(); // reloads every named defer on the page
```

`isReloadingDeferredIsland(name)` answers synchronously, so a handler can bail before starting work:

```svelte
<button
  onclick={() => {
    if (isReloadingDeferredIsland('cart')) return;
    reloadDeferredIsland('cart');
  }}>Refresh</button
>
```

It reports `true` while an island with that name has a fetch in flight — its first load as well as a reload.

<Callout type="info">

**`isReloadingDeferredIsland` is not reactive.** Reading it in markup samples it once, at render. For a spinner or a disabled button, set your own `$state` around the reload promise instead.

</Callout>

Both return a promise that settles once every matching island has finished re-fetching. Islands sharing a `name` reload together, and a `mochi:defer mochi:hydrate` island unmounts its old component and re-hydrates on each reload. Reloads on the same island queue behind one another, so a reload issued after a mutation always observes it.

`name` works on `mochi:defer:visible` too. A reload fetches immediately regardless of viewport, and replaces the element the viewport trigger was watching — after a manual reload, only further `reloadDeferredIsland` calls refresh it.

Naming an island also opts it out of [nested inlining](#nesting-islands-inside-a-server-island): a reloadable island needs its own placeholder to fetch into.

<Callout type="info">

`reloadDeferredIsland` runs in the browser — call it from a hydrated island or other client code. During SSR no islands are mounted, so it resolves immediately and does nothing.

</Callout>

<Callout type="warning">

**A reload resolves even if the fetch failed.** It reuses the same retry-and-backoff policy as the initial load, so a hard failure resolves only after the retry budget is spent (default 9 retries, up to ~27s) and leaves the previous content in place. Lower `retries` on islands you invalidate interactively.

</Callout>

#### Loading state while reloading

A reloading island shows the same fallback children it showed on first load, and carries two attributes for the duration:

```html
<mochi-server-island data-reloading aria-busy="true"></mochi-server-island>
```

Style `data-reloading` to mark the wait. Island wrappers are `display: contents`, so they generate no box of their own — put the styles on the children:

```css
mochi-server-island[data-reloading] > * {
  opacity: 0.6;
}
```

Give the island fallback children if you want a skeleton on reload — an island with none reloads into empty space, exactly as it looked before its first load. If the fetch fails, the content from before the reload is put back rather than leaving the skeleton up.

Size the fallback to match the loaded content, or the swap shifts the page. The wrapper is `display: contents`, so it holds no space of its own while the content is away — the fallback's own box is the only thing keeping the layout still. Giving both a shared `min-height` is usually enough:

```css
.card,
.card-skeleton {
  min-height: 3.5rem;
}
```

Reloads also dispatch two bubbling `CustomEvent`s, so code that did not start the reload can still react:

```ts
document.addEventListener('mochi:island:reloadend', (e) => {
  const { name, component, ok } = e.detail;
});
```

`mochi:island:reloadstart` carries `{ name, component }`; `mochi:island:reloadend` adds `ok`, `false` when the fetch failed and the island rolled back.

### Nesting islands inside a server island

A server island's content is a full render, so it can contain `mochi:hydrate` islands and further `mochi:defer` server islands. Hydratable children hydrate once the deferred HTML lands.

```svelte
<!-- file: src/Dashboard.svelte (rendered via mochi:defer) -->
<Chart mochi:hydrate {data} />
<Notifications mochi:defer />
```

Mochi **inlines** nested `mochi:defer` islands into the parent's fetch. When the island endpoint renders `Dashboard`, it renders `Notifications` in-process too, so one request returns the whole chain no matter how deep it nests. The decision happens at render time. A nested island inside `{#if}` or `{#each}` inlines when its branch renders, with the same props the placeholder would seal, so Mochi never renders an unreachable island. If an inlined child throws, it degrades to a fetch placeholder and fetches on its own. The parent's content stays intact.

Inlining is capped at 32 expansions per island fetch. A recursive chain and a long `{#each}` list draw from the same budget. Past the cap, children fall back to fetching. Tune the cap per fetch with the `serverIsland:inlineBudget` filter (see [Extensions](/docs/extensions/)).

Opt out per call site to keep a child on its own fetch. This helps when a slow child must not delay the parent's content:

```svelte
<Notifications mochi:defer={{ inline: false }} />
```

Opt out globally with `inlineNestedIslands`:

```ts
Mochi.serve({ inlineNestedIslands: false });
```

`mochi:defer:visible` children are always exempt. Laziness is their point, so they keep their own viewport-triggered fetch.

Mochi delivers CSS for nested islands with the fetched HTML. The host page cannot link it ahead of time, because the island content does not render until the island resolves. Styles apply as soon as the island appears.

<Callout type="warning">

**`mochi:defer` inside a hydratable subtree is a compile error.** A component marked `mochi:hydrate*` or `mochi:clientOnly` re-renders on the client, where a server island cannot exist. Remove `mochi:defer` from the child — it already renders as part of the parent's island fetch — or remove the hydrate directive from the parent.

</Callout>

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

Mochi encrypts props with a key derived from `process.env.MOCHI_KEY` (base64url-encoded, any length). Without `MOCHI_KEY`, Mochi generates a random key and logs a warning — fine for local dev, broken across restarts and multi-instance deploys.

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
{ href: "/demos/server-island/", title: "Server Islands", hook: "How server islands work — components marked mochi:defer render server-side on demand after the initial page is delivered." },
{ href: "/demos/defer-invalidation/", title: "Invalidate mochi:defer islands", hook: "How to reload server islands on demand — name a mochi:defer island and call reloadDeferredIsland(name) from the browser to re-fetch its server HTML." },
{ href: "/demos/nested-islands/", title: "Nested Islands", hook: "How nested islands work — a mochi:defer server island wrapping mochi:hydrate components, and server islands nesting more server islands." },
{ href: "/demos/lazy-server-island/", title: "Lazy Server Islands", hook: "How lazy server islands work — server islands marked mochi:defer:visible only fetch when the wrapper scrolls into view." },
]}
/>
