<script lang="ts">
  import { hydratable } from 'svelte';

  const value = await hydratable('mochi-test:clobber', () => ({ label: 'from-island' }));
</script>

<p>{value.label}</p>
