<script lang="ts">
  import Widget from './Widget.svelte';
</script>

{#snippet fallback()}<p data-fallback>loading</p>{/snippet}

<main>
  <Widget mochi:clientOnly={fallback} label="hi" />
</main>
