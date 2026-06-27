<script lang="ts">
  import Field from './Field.svelte';
</script>

<Field>
  <p>Never server-rendered — the id is minted in the browser at mount 🏝️🖥️</p>
</Field>

<style>
  p {
    margin: 0;
  }
</style>
