<script lang="ts">
  import Widget from './Widget.svelte';
</script>

<main>
  <Widget mochi:clientOnly label="hi"><p data-fallback>loading</p></Widget>
</main>
