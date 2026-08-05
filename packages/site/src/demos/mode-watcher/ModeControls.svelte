<script lang="ts">
  import { ModeWatcher, toggleMode, setMode, resetMode, mode, userPrefersMode, systemPrefersMode, modeStorageKey } from 'mode-watcher';
  import { onMount } from 'svelte';
  import Badge from '../../components/Badge.svelte';

  // resetMode() persists async, which won't flush before a hard navigation unloads the page, so
  // clear mode-watcher's stored key synchronously on leave — the demo hands <html> back to system.
  onMount(() => {
    const reset = () => localStorage.removeItem(modeStorageKey.current);
    window.addEventListener('pagehide', reset);
    return () => window.removeEventListener('pagehide', reset);
  });
</script>

<ModeWatcher />

<div class="grid">
  <div class="card">
    <div class="head">
      <h3>toggleMode</h3>
      <span class="hint">flip the global &lt;html&gt; between light and dark</span>
    </div>
    <div class="preview">
      <span class="dot"></span>
      {#if mode.current}
        <Badge kind={mode.current === 'dark' ? 'info' : 'success'}>{mode.current}</Badge>
      {:else}
        <Badge kind="warning">undefined (server)</Badge>
      {/if}
    </div>
    <button class="primary" onclick={toggleMode}>Toggle mode</button>
  </div>

  <div class="card">
    <div class="head">
      <h3>setMode / resetMode</h3>
      <span class="hint">user pick vs resolved vs OS</span>
    </div>
    <div class="actions">
      <button onclick={() => setMode('light')}>Light</button>
      <button onclick={() => setMode('dark')}>Dark</button>
      <button onclick={resetMode}>System</button>
    </div>
    <dl class="readout">
      <div>
        <dt>userPrefersMode</dt>
        <dd>{userPrefersMode.current}</dd>
      </div>
      <div>
        <dt>mode (resolved)</dt>
        <dd>{mode.current ?? '—'}</dd>
      </div>
      <div>
        <dt>systemPrefersMode</dt>
        <dd>{systemPrefersMode.current ?? '—'}</dd>
      </div>
    </dl>
  </div>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1rem;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .head h3 {
    font-size: 1rem;
    font-weight: 700;
    margin: 0;
    color: var(--text);
    font-family: var(--font-mono);
  }

  .hint {
    font-size: 0.75rem;
    color: var(--text-subtle);
  }

  .preview {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.9rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: #ffffff;
    color: #1a1a1a;
    transition:
      background 0.2s ease,
      color 0.2s ease;
  }

  :global(html.dark) .preview {
    background: #10131a;
    color: #f4f5f7;
  }

  .dot {
    width: 0.9rem;
    height: 0.9rem;
    border-radius: 999px;
    background: #f6c453;
    box-shadow: 0 0 0 3px rgba(246, 196, 83, 0.25);
  }

  :global(html.dark) .dot {
    background: #6d7ce0;
    box-shadow: 0 0 0 3px rgba(109, 124, 224, 0.3);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  button {
    padding: 0.4rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease;
  }

  button:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-soft-text);
  }

  button.primary {
    align-self: flex-start;
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text, #fff);
  }

  .readout {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .readout > div {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.75rem;
  }

  .readout dt {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .readout dd {
    margin: 0;
    font-family: var(--font-mono);
    font-weight: 700;
    color: var(--accent);
  }
</style>
