<script lang="ts">
  import VendorTwo, { parse } from './vendorTwo';
  import { sharedLabel } from './shared';

  let count = $state(1);
  const tag = new VendorTwo().tag;
</script>

<button onclick={() => count--}>{tag}:{parse(String(count))}:{sharedLabel(count)}</button>
