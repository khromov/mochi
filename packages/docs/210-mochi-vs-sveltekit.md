---
title: 'Mochi vs SvelteKit'
slug: mochi-vs-sveltekit
description: 'A side-by-side feature comparison of Mochi and SvelteKit, filterable by performance, backend, and frontend concerns.'
---

<script>
  import ComparisonTable from './_components/ComparisonTable.svelte';
</script>

## Mochi vs SvelteKit

Mochi and SvelteKit both render Svelte 5 on the server, but they make different bets. Mochi is SSR-first on Bun with islands-based selective hydration and a batteries-included backend (SQLite, queues, WebSockets, SSE, caching). SvelteKit is runtime-agnostic with a client-side router, broad deployment targets, and a mature ecosystem.

Use the filters below to focus on the areas you care about, or switch to **Mochi only** / **SvelteKit only** to see where each framework leads.

<ComparisonTable mochi:hydrate />

If you're migrating an existing app, the [Coming from SvelteKit](/docs/coming-from-sveltekit/) guide maps each SvelteKit concept to its Mochi equivalent.
