<script lang="ts">
  import Healthy from './Healthy.svelte';
  import Throwing from './Throwing.svelte';
</script>

<main>
  <Healthy mochi:hydrate label="alpha" />
  <Throwing mochi:hydrate />
  <Healthy mochi:hydrate label="omega" />
</main>
