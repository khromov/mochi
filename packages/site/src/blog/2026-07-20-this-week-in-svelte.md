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

<YouTubeEmbed mochi:hydrate id="HCpuzfRdVvI" title="This Week in Svelte — Mochi" />

I joined Paolo Ricciuti on _This Week in Svelte_ to demo Mochi and talk through the design decisions behind it. The Mochi segment starts at [40:16](https://www.youtube.com/watch?v=HCpuzfRdVvI&t=2535s).

Most of the conversation was about why Mochi exists at all. I work at a publishing house, and the sites we build get visited once a month by most readers — or all at once, by everyone, when something happens in the world. That is a very different problem from the one most modern meta frameworks optimize for. A page that resolves into place through fifteen spinners after a megabyte of JavaScript is fine for an app you open daily; it is not fine for a news site during a storm. Astro got us most of the way there, and using it for the past year made me want the same island-shaped model narrowed all the way down: Svelte only, no other renderers, no bundler-shaped conventions to work around.

The other half is the constraint. SvelteKit has to run everywhere — static hosts, serverless, the edge — and that generality shows up in what its API can and can't offer. If you instead say up front that you only deploy to a stateful server, a lot of things stop being products you pay for and start being things you already have: WebSockets, caching, image transforms. Paolo pushed back on this, fairly — the adapter pattern is genuinely one of SvelteKit's quiet strengths, and being able to move hosts by swapping one package is worth something. Mochi trades it away deliberately.

The walkthrough itself covered scaffolding a project, adding [`mochi:hydrate`](/docs/selective-hydration/) to a counter and watching the JavaScript appear in the network tab for the first time, and switching it to [`mochi:defer`](/docs/server-islands/) so the component renders in a separate request that can carry its own cache headers. I also showed both data-loading styles — `serverProps` on the route, and an `await` at the top of a server-rendered component — and used the debug bar to catch the classic mistake of passing a 183 KB API response into an island when the component only reads one field off it. That kind of thing is invisible in most setups; here it is a red number in the corner of the screen.

We also talked about what isn't there yet. File-based routing came up from the chat and from Paolo, and it's on my list to revisit before 1.0 — probably through the extension API rather than baked into the core. Hot module reloading is the other honest gap: saying no to Vite means writing it yourself, and today a change reloads the page rather than preserving island state.

Mochi is early and there are bugs. If any of this sounds like the trade-off you'd want, the [docs](/docs/intro/) and [demos](/demos/) are the fastest way in, and I'd genuinely like to hear what breaks — [Discord](/discord/) or a GitHub issue, either works.
