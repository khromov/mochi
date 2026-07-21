<script lang="ts">
  import Widget from './Widget.svelte';

  let { label }: { label: string } = $props();
</script>

<main>
  <Widget mochi:hydrate {label} />
</main>
