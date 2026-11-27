<script lang="ts">
  import Hidden from './Hidden.svelte';
  let open = $state(false);
</script>

<button data-toggle onclick={() => (open = !open)}>toggle</button>
{#if open}
  <Hidden />
{/if}

<style>
  [data-toggle] {
    color: darkgreen;
  }
</style>
