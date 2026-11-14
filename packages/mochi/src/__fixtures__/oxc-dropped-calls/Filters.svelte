<script lang="ts">
  import { watchAll } from './tracker.svelte';

  let filters = $state(['red']);
  let page = $state(1);
  $effect(() => {
    String(filters); // read every filter so this effect re-runs on any change
    page = 1;
  });
  watchAll(filters);
</script>

<p>Page: <span id="page">{page}</span></p>
<button id="next" onclick={() => page++}>Next page</button>
<button id="add" onclick={() => filters.push('blue')}>Add "blue" filter</button>
