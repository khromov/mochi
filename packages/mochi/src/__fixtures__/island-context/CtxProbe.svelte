<script lang="ts">
  import { isHydratable } from 'mochi-framework';

  const hydratable = isHydratable();
</script>

<span data-ctx={String(hydratable)}>ctx</span>
