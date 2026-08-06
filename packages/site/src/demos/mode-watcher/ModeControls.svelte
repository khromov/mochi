<script lang="ts">
  import { ModeWatcher, toggleMode, setMode, resetMode, mode, userPrefersMode, systemPrefersMode } from 'mode-watcher';
  import { cookies, isBrowser } from 'mochi-framework';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';
  import Badge from '../../components/Badge.svelte';
  import { THEME_COOKIE } from './constants';

  let { initialMode = null }: { initialMode?: string | null } = $props();

  const defaultMode = $derived(initialMode === 'light' || initialMode === 'dark' ? initialMode : 'system');

  // Mirror the resolved mode into a cookie so the server can render the right theme next time —
  // mode-watcher itself only persists to localStorage, which the server can't read.
  $effect(() => {
    const m = mode.current;
    if (isBrowser && (m === 'light' || m === 'dark')) {
      cookies.set(THEME_COOKIE, m, { expires: 365, path: '/demos/mode-watcher/', sameSite: 'Lax' });
    }
  });
</script>

<ModeWatcher {defaultMode} />

<header class="ssr-header">
  <div class="ssr-copy">
    <strong>SSR theme</strong>
    <span>server-rendered from a cookie — no flash on reload</span>
  </div>
  <div class="ssr-controls">
    <code>server sent: {initialMode ?? '(no cookie yet)'}</code>
    <button class="switch" onclick={toggleMode}>
      {#if mode.current === 'dark'}
        <Sun size={15} /> Light
      {:else}
        <Moon size={15} /> Dark
      {/if}
    </button>
  </div>
</header>

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
  .ssr-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.9rem 1.1rem;
    margin-bottom: 1.25rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: #ffffff;
    color: #1a1a1a;
    transition:
      background 0.2s ease,
      color 0.2s ease;
  }

  :global(html.dark) .ssr-header {
    background: #10131a;
    color: #f4f5f7;
  }

  .ssr-copy {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .ssr-copy strong {
    font-size: 0.95rem;
  }

  .ssr-copy span {
    font-size: 0.75rem;
    opacity: 0.7;
  }

  .ssr-controls {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .ssr-controls code {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    opacity: 0.75;
  }

  .switch {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-text, #fff);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }

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
