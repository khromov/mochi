<script lang="ts">
  import Probe from './Probe.svelte';
  import CtxProbe from './CtxProbe.svelte';
</script>

<section>
  <Probe mochi:hydrate><CtxProbe /></Probe>
  <Probe />
  <CtxProbe />
</section>
