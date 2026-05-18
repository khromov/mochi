<script lang="ts">
  import { isBrowser } from 'mochi-framework';

  let result = $state('');
  let loading = $state(false);
  let addA = $state(2);
  let addB = $state(3);

  async function callApi(url: string, options?: RequestInit) {
    if (!isBrowser) {
      return;
    }
    loading = true;
    result = '';
    try {
      const res = await fetch(url, options);
      const json = await res.json();
      result = JSON.stringify(json, null, 2);
    } catch (e: unknown) {
      result = `Error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      loading = false;
    }
  }

  function health() {
    callApi('/health');
  }

  function add() {
    callApi('/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: addA, b: addB }),
    });
  }
</script>

<div class="api-tester">
  <div class="endpoints">
    <button class="endpoint-btn" onclick={health}>
      <span class="method get">GET</span>
      <span class="path">/health</span>
    </button>

    <div class="add-row">
      <button class="endpoint-btn" onclick={add}>
        <span class="method post">POST</span>
        <span class="path">/add</span>
      </button>
      <div class="add-inputs">
        <input type="number" bind:value={addA} />
        <span class="plus">+</span>
        <input type="number" bind:value={addB} />
      </div>
    </div>
  </div>

  <div class="result" class:has-content={result !== ''}>
    {#if loading}
      <span class="loading">Loading...</span>
    {:else if result}
      <pre>{result}</pre>
    {:else}
      <span class="placeholder">Click an endpoint to test it</span>
    {/if}
  </div>
</div>

<style>
  .api-tester {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .endpoints {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .endpoint-btn {
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
    text-align: left;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      color 0.12s ease;
  }

  .endpoint-btn:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-soft-text);
  }

  .endpoint-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .method {
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.18rem 0.5rem;
    border-radius: var(--radius-sm);
    letter-spacing: 0.04em;
    font-family: var(--font-mono);
  }

  .method.get {
    background: var(--badge-success-bg);
    color: var(--badge-success-text);
  }

  .method.post {
    background: var(--badge-warning-bg);
    color: var(--badge-warning-text);
  }

  .path {
    font-family: var(--font-mono);
    font-size: 0.95rem;
    color: inherit;
  }

  .add-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .add-inputs {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .add-inputs input {
    width: 56px;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 0.95rem;
    text-align: center;
    outline: none;
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease;
  }

  .add-inputs input:focus {
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
  }

  .plus {
    color: var(--text-subtle);
    font-weight: 500;
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
