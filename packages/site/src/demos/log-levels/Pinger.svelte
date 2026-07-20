<script lang="ts">
  import { isBrowser } from 'mochi-framework';

  let fired = $state<string[]>([]);

  async function ping(path: string, label: string) {
    if (!isBrowser) {
      return;
    }
    await fetch(path);
    fired = [`${new Date().toLocaleTimeString()} → ${label}`, ...fired].slice(0, 6);
  }
</script>

<div class="pinger">
  <div class="buttons">
    <button onclick={() => ping('/demos/log-levels/loud/', 'promoted to warn')}>
      <span class="path">/demos/log-levels/loud</span>
      <span class="level warn">warn</span>
    </button>
    <button onclick={() => ping('/demos/log-levels/quiet/', 'demoted to debug — hidden')}>
      <span class="path">/demos/log-levels/quiet</span>
      <span class="level debug">debug</span>
    </button>
  </div>

  <div class="fired">
    {#if fired.length === 0}
      <span class="placeholder">Fire a request, then look at the terminal running the server.</span>
    {:else}
      <ul>
        {#each fired as entry (entry)}
          <li>{entry}</li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .pinger {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  button {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.85rem;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.95rem;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      color 0.12s ease;
  }

  button:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-soft-text);
  }

  button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .path {
    font-family: var(--font-mono);
    font-size: 0.9rem;
  }

  .level {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    font-family: var(--font-mono);
    padding: 0.18rem 0.5rem;
    border-radius: var(--radius-sm);
  }

  .level.warn {
    background: var(--badge-warning-bg);
    color: var(--badge-warning-text);
  }

  .level.debug {
    background: var(--badge-default-bg);
    color: var(--badge-default-text);
  }

  .fired {
    background: var(--code-bg);
    border-radius: var(--radius-md);
    padding: 0.9rem 1rem;
    min-height: 56px;
  }

  .placeholder {
    color: var(--code-muted);
    font-size: 0.9rem;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  li {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: var(--code-accent);
  }
</style>
