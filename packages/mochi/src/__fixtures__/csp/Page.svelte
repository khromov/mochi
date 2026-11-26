<script lang="ts">
  import { getCspNonce } from 'mochi-framework';
  import { hydratable } from 'svelte';
  import Probe from './Probe.svelte';
  import Deferred from './Deferred.svelte';

  const nonce = getCspNonce();
  const fromServer = hydratable('mochi-test:csp', () => 'frozen-on-server');
</script>

<section>
  <p data-csp-nonce={nonce}>{fromServer}</p>
  <Probe mochi:hydrate label="from-server" />
  <Deferred mochi:defer />
</section>
