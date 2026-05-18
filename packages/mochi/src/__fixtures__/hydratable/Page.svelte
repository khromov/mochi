<script lang="ts">
  import { hydratable } from 'svelte';

  const value = hydratable('mochi-test:val', () => ({
    n: 42,
    label: 'frozen-on-server',
  }));
</script>

<p data-testid="n">{value.n}</p>
<p data-testid="label">{value.label}</p>
