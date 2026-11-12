<script lang="ts">
  import { hydratable } from 'svelte';

  const value = await hydratable<{ n: number; label: string }>('mochi-test:shared', () => {
    throw new Error('island hydratable fallback ran');
  });
</script>

<p data-testid="island">island-{value.label}-{value.n}</p>
