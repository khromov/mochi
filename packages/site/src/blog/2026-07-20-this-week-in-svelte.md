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

Much of the conversation was about the central trade-off of SvelteKit and how Mochi is different. SvelteKit has to run everywhere — static hosts, serverless, the edge — and that generality shapes what its API can offer. If you only deploy to a stateful server, a lot of things stop being services you pay for and start being things you already have: real-time, caching, queues and image resizing are just some of the things you get for free.

The demo itself covered:

- Scaffolding a project and adding [`mochi:hydrate`](/docs/selective-hydration/) to a counter, watching JavaScript appear in the network tab for the first time.
- Switching it to [`mochi:defer`](/docs/server-islands/), so the component renders in a separate request with its own cache headers.
- Both data-loading styles — `serverProps` on the route, and an `await` at the top of a server-rendered component.
- Using the debug bar to catch a 183 KB API response being passed into an island that only reads one field off it.

We also talked about what isn't there yet. File-based routing came up from Paolo and from the chat, and it's on my list to revisit before 1.0 — likely through an extensions API rather than baked into the core. Hot module reloading is the other honest gap: the current solution is not as nice as SvelteKit's.

Mochi is early and in alpha. If that trade-off sounds like one you'd want, the [docs](/docs/intro/) and [demos](/demos/) are the fastest way in, and I'd like to hear what breaks — [Discord](/discord/) or a GitHub issue, either works.
