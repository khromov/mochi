<script lang="ts">
  import Field from './Field.svelte';

  let clicks = $state(0);
</script>

<Field>
  <p>Rendered on the server, then hydrated 🏝️⚡</p>
  <button onclick={() => clicks++}>Clicked {clicks} times</button>
</Field>

<style>
  p {
    margin: 0;
  }
  button {
    padding: 0.4rem 0.8rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface-2, var(--surface));
    color: var(--text);
    cursor: pointer;
  }
</style>
