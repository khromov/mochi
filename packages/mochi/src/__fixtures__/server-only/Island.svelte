<script lang="ts">
  import { hydratable } from 'svelte';
  import { readSecret } from './secrets.server.ts';

  const value = hydratable('mochi-server-only:val', () => readSecret());
</script>

<p data-testid="value">{value}</p>
