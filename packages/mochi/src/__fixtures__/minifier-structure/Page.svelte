<script lang="ts">
  import CounterA from './CounterA.svelte';
  import CounterB from './CounterB.svelte';
  import LazyIsland from './LazyIsland.svelte';
</script>

<main>
  <CounterA mochi:hydrate />
  <CounterB mochi:hydrate />
  <LazyIsland mochi:hydrate />
</main>
