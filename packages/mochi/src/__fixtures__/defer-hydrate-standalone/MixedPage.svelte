<script lang="ts">
  import Counter from './Counter.svelte';
</script>

<h1>mixed</h1>
<Counter mochi:hydrate />
<Counter mochi:defer mochi:hydrate />
