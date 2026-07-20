<script lang="ts">
  import { hydratable } from 'svelte';
  import { readSecret } from './secrets.server.ts';
  import type { Secret } from './secrets.server.ts';

  const value = hydratable('mochi-server-only:val', () => readSecret());
  // A type-only import from a .server.ts is erased before the client build
  // sees it, so annotating against server-side types costs the client nothing.
  const described: Secret['value'] = value;
</script>

<p data-testid="value">{described}</p>
