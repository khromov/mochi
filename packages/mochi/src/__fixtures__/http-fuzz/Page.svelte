<script lang="ts">
  import Echo from './Echo.svelte';
  import Counter from './Counter.svelte';

  let { imageUrl = '' }: { imageUrl?: string } = $props();
</script>

<h1>fuzz host</h1>

<Echo mochi:defer name="World" />
<Counter mochi:hydrate label="c" />

{#if imageUrl}<img src={imageUrl} alt="fuzz" width="32" height="32" />{/if}
