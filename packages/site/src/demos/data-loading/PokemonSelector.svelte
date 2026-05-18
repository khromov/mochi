<script lang="ts">
  let { current, options } = $props<{
    current: string;
    options: { name: string }[];
  }>();

  function onChange(event: Event) {
    (event.currentTarget as HTMLSelectElement).form?.requestSubmit();
  }

  function capitalize(name: string) {
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
</script>

<form class="selector" method="POST">
  <label for="pokemon-select">Pick a Pokémon:</label>
  <select id="pokemon-select" name="pokemon" value={current} onchange={onChange}>
    {#each options as option (option.name)}
      <option value={option.name} selected={option.name === current}>
        {capitalize(option.name)}
      </option>
    {/each}
  </select>
  <noscript>
    <button type="submit">Go</button>
  </noscript>
</form>

<style>
  .selector {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  label {
    font-size: 0.85rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  select {
    flex: 1;
    min-width: 0;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 0.9rem;
    cursor: pointer;
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease;
  }

  select:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
  }

  button {
    padding: 0.5rem 0.9rem;
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
    background: var(--accent);
    color: var(--accent-text);
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s ease;
  }

  button:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
</style>
