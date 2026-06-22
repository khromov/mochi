---
title: 'Welcome'
slug: intro
description: 'A lightweight, server-first Svelte 5 framework running on Bun that ships client-side JavaScript only for interactive islands.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import IslandsDemo from './_components/IslandsDemo.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
  import ComparisonTable from './_components/ComparisonTable.svelte';
</script>

# mochi

Mochi is a lightweight, server-first framework for [Svelte 5](https://svelte.dev/) on [Bun](https://bun.sh/). Mochi websites render server-side on every request and ship as plain HTML. Components only ship JavaScript when you explicitly mark them as islands.

## Server-rendered, with island interactivity

The websites we visit on the web are mostly static — text, images and links. Only a handful of elements on any given page actually need to be interactive: a search box, a logged-in badge, a comments widget. Mochi reflects this at the core of its design. Mochi sites renders server-side as plain HTML; the interactive pieces are marked with the `mochi:hydrate` directive and ship JS as interactive islands embedded in that HTML.

Go ahead, try hydrating the page below and see which components will load JavaScript.

<IslandsDemo mochi:hydrate />

The header text, the main column, and the footer ship as HTML and stay that way. The badge and the sidebar nav are wrapped as islands — same SSR HTML on first paint, with JS attached on top. Everything else is zero-JS forever.

## Why would I consider Mochi over SvelteKit?

- **Faster sites.** Mochi ships zero client JavaScript by default. SvelteKit code-splits per route but still hydrates the entire page — even purely static content. Mochi only hydrates the components you explicitly mark as islands, which means less JS on first load, better bfcache behavior, and a natural fit for any site.
- **Performant hydration.** Avoid hydrating islands until the users scrolls into them with `mochi:hydrate:visible`. Or avoid hydrating at all if the user never scrolls down to that component. Your users will thank you for the faster experience.
- **Uses the platform.** Mochi ships with first-class support for View Transitions. No client side router, no state to keep track of between requests.
- **No heavy bundler (no Vite).** Uses the lighting-fast Bun bundler, which builds sites with hundreds of routes in seconds.
- **Real-time built in.** WebSockets and Server Sent Events are first-class route types — no extra packages or services required.

Want to know more? Expand the table below to see a full feature comparison.

<ComparisonTable mochi:hydrate collapsed />

<Callout type="info">

**Mochi is in early development.** Only use in production if you are brave.

</Callout>

## Community

Questions, bug reports, ideas, or just want to see what others are building? Join the [Mochi Discord](/discord/).

<SeeItInAction
demos={[
{ href: "/demos/hello-world/", title: "Hello World", hook: "The simplest possible Mochi page — pure server-rendered Svelte." },
{ href: "/demos/hydration/", title: "Hydration Modes", hook: "The same component rendered five ways — eager, lazy, visible, rootMargin-tuned, and deferred server island." },
{ href: "/demos/server-props/", title: "Server Props", hook: "Define serverProps on Mochi.page() to pass fresh data into a Svelte page on every request." },
]}
/>
