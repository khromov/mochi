---
title: 'Welcome'
slug: intro
description: 'A server-first Svelte 5 framework on Bun. It renders plain HTML and ships client JavaScript only for interactive islands.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import IslandsDemo from './_components/IslandsDemo.svelte';
  import ComparisonTable from './_components/ComparisonTable.svelte';
  import ExpandComparison from './_components/ExpandComparison.svelte';
</script>

# mochi

Mochi is a server-first framework for [Svelte 5](https://svelte.dev/) on [Bun](https://bun.sh/). It renders each page as plain HTML. It ships JavaScript only for the components you mark as islands.

## Server-rendered, with island interactivity

Most web pages are mostly static: text, images, and links. Only a few elements need to be interactive, such as a search box, a logged-in badge, or a comments widget. Mochi builds on this fact.

Mochi renders each page on the server as plain HTML. You mark each interactive piece with a `mochi:*` directive. Each marked piece is an _island_. An island ships its JavaScript inside the page HTML.

Hydrate the page below to see which components load JavaScript.

<IslandsDemo mochi:hydrate />

The header, the main column, and the footer ship as HTML and stay HTML. The badge and the sidebar are islands. They render the same HTML on first paint, then attach JavaScript on top. Everything else ships zero JavaScript.

## Why choose Mochi?

- **Faster sites.** Mochi ships zero client JavaScript by default. It hydrates only the components you mark as islands. Less JavaScript on first load means faster pages and better bfcache behavior.
- **Fast hydration.** Use `mochi:hydrate:visible` to hydrate an island only when the user scrolls to it. An island the user never reaches never hydrates.
- **Built on the platform.** Mochi supports View Transitions out of the box. Every navigation is a full page load, so there is no client state to track between requests.
- **Fast builds.** Mochi uses the Bun bundler. It builds sites with hundreds of routes in seconds.
- **Real-time built in.** WebSockets and Server-Sent Events are first-class route types. You need no extra packages or services.

For a complete feature comparison, <ExpandComparison mochi:hydrate label="expand the table below" />.

<ComparisonTable mochi:hydrate collapsed />

<Callout type="info">

**Mochi is in early development.** Expect breaking changes, and evaluate it carefully before relying on it in production.

</Callout>

## Community

Questions, bug reports, or ideas? Join the [Mochi Discord](/discord/).
