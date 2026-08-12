<script lang="ts">
  import VendorOne, { parse } from './vendorOne';
  import { sharedLabel } from './shared';

  let count = $state(0);
  const tag = new VendorOne().tag;
</script>

<button onclick={() => count++}>{tag}:{parse(String(count))}:{sharedLabel(count)}</button>
