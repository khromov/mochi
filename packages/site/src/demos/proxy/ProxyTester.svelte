<script lang="ts">
  import { isBrowser } from 'mochi-framework';

  let subpath = $state('hello/world?greeting=hi');
  let result = $state('');
  let loading = $state(false);

  async function send() {
    if (!isBrowser) {
      return;
    }
    loading = true;
    result = '';
    try {
      const res = await fetch(`/demos/proxy/up/${subpath}`);
      const json = await res.json();
      result = JSON.stringify(json, null, 2);
    } catch (e: unknown) {
      result = `Error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      loading = false;
    }
  }
</script>

<div class="proxy-tester">
  <div class="row">
    <span class="prefix">/demos/proxy/up/</span>
    <input bind:value={subpath} spellcheck="false" onkeydown={(e) => e.key === 'Enter' && send()} />
    <button onclick={send}>Send</button>
  </div>

  <div class="result" class:has-content={result !== ''}>
    {#if loading}
      <span class="loading">Loading...</span>
    {:else if result}
      <pre>{result}</pre>
    {:else}
      <span class="placeholder">Send a request — the upstream reports the prefix-stripped path it saw.</span>
    {/if}
  </div>
</div>

<style>
  .proxy-tester {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .prefix {
    font-family: var(--font-mono);
    font-size: 0.9rem;
    color: var(--text-subtle);
  }

  .row input {
    flex: 1;
    min-width: 180px;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 0.9rem;
    outline: none;
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease;
  }

  .row input:focus {
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
  }

  .row button {
    padding: 0.45rem 0.95rem;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.9rem;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      color 0.12s ease;
  }

  .row button:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-soft-text);
  }

  .row button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .result {
    background: var(--code-bg);
    border-radius: var(--radius-md);
    padding: 0.9rem 1rem;
    min-height: 56px;
    display: flex;
    align-items: center;
  }

  .result pre {
    color: var(--code-accent);
    font-family: var(--font-mono);
    font-size: 0.9rem;
    line-height: 1.5;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .placeholder {
    color: var(--code-muted);
    font-size: 0.9rem;
  }

  .loading {
    color: var(--code-muted);
    font-size: 0.9rem;
    font-style: italic;
  }
</style>
