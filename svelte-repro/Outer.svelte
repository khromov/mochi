<script>
  import Inner from './Inner.svelte';

  // `marks` is the consumer-facing prop: pass a snippet to override the default rendering.
  // (This is the exact shape LayerChart's chart shortcuts use internally.)
  let { marks } = $props();
</script>

<Inner>
  {#snippet marks({ value })}
    {#if typeof marks === 'function'}
      {@render marks({ value })}
    {:else}
      <p>default content: {value}</p>
    {/if}
  {/snippet}
</Inner>
