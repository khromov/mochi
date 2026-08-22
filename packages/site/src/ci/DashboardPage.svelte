<script lang="ts">
  import '@fontsource/public-sans';
  import '@fontsource-variable/fraunces/full.css';
  import type { CiDashboardData, CiRateLimit } from '../lib/ci';
  import CompactBoard from './CompactBoard.svelte';
  import { CI_REPO } from './repo';

  let {
    dashboard,
    rateLimit,
    serverNow,
  }: {
    dashboard: CiDashboardData | null;
    rateLimit: CiRateLimit | null;
    serverNow: number;
  } = $props();
</script>

<svelte:head>
  <title>CI — {CI_REPO}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <!-- No PageShell here, so svelte-meta-tags never runs and this is the only robots tag. -->
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<CompactBoard mochi:hydrate {dashboard} {rateLimit} {serverNow} />

<style>
  :global(body) {
    margin: 0;
    overflow: hidden;
    font-family: var(--font-sans);
  }
</style>
