<script lang="ts">
  import Inner from './Inner.svelte';

  // `marks` is the consumer-facing prop: pass a snippet to override the default rendering.
  // This is the exact shape LayerChart's chart shortcuts use (see BarChart.base.svelte etc.).
  let { marks }: { marks?: any } = $props();
</script>

<Inner>
  {#snippet marks({ value }: { value: number })}
    {#if typeof marks === 'function'}
      {@render marks({ value })}
    {:else}
      <p>default content: {value}</p>
    {/if}
  {/snippet}
</Inner>
