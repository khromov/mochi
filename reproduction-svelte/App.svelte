<script>
  import Card from './Card.svelte';
</script>

<!-- Several async children render concurrently within one render(), and the
     harness also runs renders concurrently — the concurrency Bun 1.4.0 needs to
     bleed Svelte's render-context AsyncLocalStorage. -->
{#each [0, 1, 2, 3] as i (i)}
  <Card />
{/each}
