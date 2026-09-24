<script lang="ts">
  import { onMount } from 'svelte';

  let time = $state<string | null>(null);

  onMount(() => {
    time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  });
</script>

<p class="stamp" class:done={time !== null}>
  {#if time}
    Hydrated at <time>{time}</time>, when this tile scrolled into view
  {:else}
    Not hydrated yet — scroll me into view
  {/if}
</p>
