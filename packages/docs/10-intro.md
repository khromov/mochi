---
title: 'Welcome'
slug: intro
---

<script>
  import Callout from './_components/Callout.svelte';
  import IslandsDemo from './_components/IslandsDemo.svelte';
</script>

# mochi

Mochi is a lightweight, server-first framework for [Svelte 5](https://svelte.dev/) on [Bun](https://bun.sh/). Mochi websites render server-side on every request and ship as plain HTML. Components only ship JavaScript when you explicitly mark them as islands.

## Server-rendered, with island interactivity

The websites we visit on the web are mostly static — text, images and links. Only a handful of elements on any given page actually need to be interactive: a search box, a logged-in badge, a comments widget. Mochi reflects this at the core of its design. Mochi sites renders server-side as plain HTML; the interactive pieces are marked with the `mochi:hydrate` directive and ship JS as interactive islands embedded in that HTML.

Go ahead, try hydrating the page below and see which components will load JavaScript.

<IslandsDemo />

The header text, the main column, and the footer ship as HTML and stay that way. The badge and the sidebar nav are wrapped as islands — same SSR HTML on first paint, with JS attached on top. Everything else is zero-JS forever.

## Why would I consider Mochi over SvelteKit?

- **Faster sites.** Mochi ships zero client JavaScript by default. And even when you do decide to ship interactive components, your bundles will still be smaller than SvelteKit which always ships your whole application to the client.
- **Performant hydration.** Avoid hydrating islands until the users scrolls into them with `mochi:hydrate:visible`. Or avoid hydrating at all if the user never scrolls down to that component. Your users will thank you for the faster experience.
- **Uses the platform.** Mochi ships with first-class support for View Transitions. No client side router, no state to keep track of between requests.
- **No heavy bundler (no Vite).** Uses the lighting-fast Bun bundler, which builds sites with hundreds of routes in seconds.
- **Real-time built in.** WebSockets and Server Sent Events are first-class route types — no extra packages or services required.

<Callout type="info">

**Mochi is in early development.** Only use in production if you are brave.

</Callout>

## Community

Questions, bug reports, ideas, or just want to see what others are building? Join the [Mochi Discord](https://discord.com/invite/QCGfks4gg8).
