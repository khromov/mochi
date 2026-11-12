<script lang="ts">
  import { hydratable } from 'svelte';
  import Card from './Card.svelte';

  const value = await hydratable('mochi-test:shared', () => ({ n: 42, label: 'from-page' }));
</script>

<p data-testid="page">{value.label}</p>
<Card mochi:hydrate />
