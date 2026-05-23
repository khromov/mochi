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

<IslandsDemo />

The header text, the main column, and the footer ship as HTML and stay that way. The badge and the sidebar nav are wrapped as islands — same SSR HTML on first paint, with JS attached on top. Everything else is zero-JS forever.

## Why Mochi over SvelteKit

- **Zero client JS by default.** Only components marked `mochi:hydrate`, `mochi:hydrate:visible`, or `mochi:defer` ship JS. SvelteKit hydrates every page.
- **Three hydration modes.** Eager, on-visible (`IntersectionObserver`), and deferred server islands. SvelteKit ships eager hydration only.
- **No client-side router.** Every navigation is a full HTML request. No `goto`, no `invalidate`, no prefetch graph to reason about.
- **Bun-only runtime.** No adapter ecosystem. Builds on `Bun.serve`, `bun:sqlite`, and Bun's native WebSocket / SSE.
- **Real-time built in.** `Mochi.ws()` and `Mochi.sse()` are first-class route types — no extra packages.

If you want full hydration, file-based routes, and a broad deploy-target matrix, reach for SvelteKit. If you want a content-shaped, low-JS framework that runs on one runtime — try Mochi.

<Callout type="info">

**Mochi is in early development.** Only use in production if you are brave.

</Callout>

## Community

Questions, bug reports, ideas, or just want to see what others are building? Join the [Mochi Discord](https://discord.com/invite/QCGfks4gg8).
