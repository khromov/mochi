<script lang="ts">
  let open = $state(false);
</script>

<button data-loader onclick={() => (open = !open)}>load</button>
{#if open}
  {#await import('./Lazy.svelte') then { default: Lazy }}
    <Lazy />
  {/await}
{/if}

<style>
  [data-loader] {
    color: maroon;
  }
</style>
