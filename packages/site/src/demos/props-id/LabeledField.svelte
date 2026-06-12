<script lang="ts">
  const uid = $props.id();

  let value = $state('');
</script>

<div class="card">
  <label for="{uid}-name">Name</label>
  <input id="{uid}-name" type="text" bind:value placeholder="Type here…" />
  <button onclick={() => document.getElementById(`${uid}-name`)?.focus()}>Focus input via its id</button>
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
  input {
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2, var(--surface));
    color: var(--text);
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
    margin: 0;
    flex-basis: 100%;
    color: var(--text-muted);
    font-size: 0.85em;
  }
</style>
