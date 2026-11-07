---
title: 'Mochi vs SvelteKit'
slug: mochi-vs-sveltekit
description: 'A side-by-side feature comparison of Mochi and SvelteKit, filterable by performance, backend, and frontend.'
---

<script>
  import ComparisonTable from './_components/ComparisonTable.svelte';
</script>

## Mochi vs SvelteKit

Mochi and SvelteKit both render Svelte 5 on the server, and they make different bets. Mochi is SSR-first on Bun with islands-based selective hydration and a batteries-included backend (SQLite, queues, WebSockets, SSE, caching). SvelteKit is runtime-agnostic with a client-side router, broad deployment targets, and a mature ecosystem.

Use the filters below to focus on the areas you care about, or switch to **Mochi only** / **SvelteKit only** to see where each framework leads.

<ComparisonTable mochi:hydrate />

Migrating an existing app? The [Coming from SvelteKit](/docs/coming-from-sveltekit/) guide maps each SvelteKit concept to its Mochi equivalent.
