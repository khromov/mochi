<script lang="ts">
  import Probe from './Probe.svelte';
</script>

<section>
  <!-- Hydrated island with a nested plain child: both should read hydratable=true -->
  <Probe mochi:hydrate nest />
  <!-- Plain SSR-only sibling: hydratable=false -->
  <Probe />
</section>
