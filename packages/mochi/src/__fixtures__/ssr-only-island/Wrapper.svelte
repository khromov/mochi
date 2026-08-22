<script lang="ts">
  import Changelog from './Changelog.server.svelte';

  let clicks = $state(0);
</script>

<button onclick={() => clicks++}>{clicks}</button>
<Changelog />
