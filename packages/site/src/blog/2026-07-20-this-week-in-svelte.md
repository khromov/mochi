---
title: Mochi on This Week in Svelte
slug: this-week-in-svelte
description: A live walkthrough of Mochi with Paolo Ricciuti on This Week in Svelte.
date: '2026-07-20'
author: stanislav
---

<script>
  import YouTubeEmbed from '../components/YouTubeEmbed.svelte';
</script>

# Mochi on This Week in Svelte

<YouTubeEmbed mochi:hydrate id="HCpuzfRdVvI" start={2535} title="This Week in Svelte — Mochi" />

I joined Paolo Ricciuti on _This Week in Svelte_ to demo Mochi and talk through the thinking behind it. The Mochi segment starts at [40:16](https://www.youtube.com/watch?v=HCpuzfRdVvI&t=2535s).

We spent a while on SvelteKit, and where Mochi goes a different way. SvelteKit has to run everywhere — static hosts, serverless, the edge — and that generality shapes what its API can offer. Mochi only targets a stateful server, so it can lean on things SvelteKit can't assume you have — real-time, caching, queues and image resizing are all in the box.

The rest of the segment was live coding:

- A brand new app from `bun create mochi@latest`.
- A click counter that stubbornly did nothing, because the page shipped zero JavaScript, until [`mochi:hydrate`](/docs/selective-hydration/) turned it into an island and the first script tag showed up in the network tab.
- The same counter as a [server island](/docs/server-islands/) with `mochi:defer`, fetched in its own request so it can be cached separately from the page around it.
- A Pokémon page pulling live data from an API, first through `serverProps` on the route, then with a plain `await` at the top of the component.
- That page nearly shipping its entire 183 KB API response to the browser as island props — spotted in the debug bar, and cut down to 22 bytes by passing only the field the island actually reads.

We also talked about what isn't there yet. File-based routing came up from Paolo and from the chat, and it's on my list to revisit before 1.0 — likely through an extensions API rather than baked into the core. I'm also not happy with hot module reloading — it works, but SvelteKit's is nicer.

Mochi is early and in alpha. The [docs](/docs/intro/) and [demos](/) are the fastest way in, and I'd genuinely like to hear what breaks — [Discord](/discord) or a [GitHub issue](https://github.com/khromov/mochi/issues), either works.
