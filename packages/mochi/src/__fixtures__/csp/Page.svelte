<script lang="ts">
  import { getCspNonce } from 'mochi-framework';
  import Probe from './Probe.svelte';

  const nonce = getCspNonce();
</script>

<section>
  <p data-has-nonce={String(Boolean(nonce))}>csp</p>
  <Probe mochi:hydrate label="from-server" />
</section>
