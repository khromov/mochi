<script lang="ts">
  import HydrateParent from './HydrateParent.svelte';
  import CombinedParent from './CombinedParent.svelte';
</script>

<HydrateParent mochi:hydrate />
<CombinedParent mochi:defer mochi:hydrate />
