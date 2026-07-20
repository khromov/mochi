<script lang="ts">
  import AmbiguousRoot from './AmbiguousRoot.svelte';
  import { willHydrate } from './ctx';

  const hydrating = willHydrate();
</script>

<span data-ctx={String(hydrating)}>ctx</span>
<AmbiguousRoot mochi:hydrate />
