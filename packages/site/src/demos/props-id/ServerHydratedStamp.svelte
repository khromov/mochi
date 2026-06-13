<script lang="ts">
  const uid = $props.id();

  let clicks = $state(0);
</script>

<div class="card">
  <p>Rendered on the server, then hydrated 🏝️⚡</p>
  <button onclick={() => clicks++}>Clicked {clicks} times</button>
  <p class="uid">$props.id(): <code>{uid}</code></p>
</div>

<style>
  .card {
    padding: 1rem 1.25rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    margin-top: 1rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
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
  .uid {
    flex-basis: 100%;
    color: var(--text-muted);
    font-size: 0.85em;
  }
</style>
