<script lang="ts">
  import type { Snippet } from 'svelte';
  import { isServer } from 'mochi-framework';
  import { delay } from '../../components/sourceUtils';

  // `children` is the mochi:defer fallback, never rendered by this component — typed so the call sites accept it.
  let { repo }: { repo: string; children?: Snippet } = $props();

  await (isServer ? delay(400, 900) : Promise.resolve());

  // svelte-ignore state_referenced_locally
  // Stands in for a cached GitHub call: the point is that the props are tiny and the data is fetched server-side.
  const stars = [...repo].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 4000;
</script>

<span class="stars">★ {stars.toLocaleString()}</span>

<style>
  .stars {
    display: inline-block;
    min-width: 5.5rem;
    padding: 0.15rem 0.5rem;
    border-radius: var(--radius-sm);
    background: var(--badge-info-bg);
    color: var(--badge-info-text);
    font-family: var(--font-mono);
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
</style>
