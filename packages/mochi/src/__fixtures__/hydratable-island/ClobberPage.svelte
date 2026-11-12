<script lang="ts">
  import { hydratable } from 'svelte';
  import ClobberCard from './ClobberCard.svelte';

  const value = await hydratable('mochi-test:clobber', () => ({ label: 'from-page' }));
</script>

<p>{value.label}</p>
<ClobberCard mochi:hydrate />
