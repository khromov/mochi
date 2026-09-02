<script lang="ts">
  import { isBrowser } from 'mochi-framework';

  let fetched = $state('');
  let loading = $state(false);

  async function load() {
    if (!isBrowser) {
      return;
    }
    loading = true;
    try {
      const res = await fetch('/demos/request-id/api');
      fetched = ((await res.json()) as { requestId: string }).requestId;
    } finally {
      loading = false;
    }
  }
</script>

<div class="fetcher">
  <button onclick={load} disabled={loading}>
    {loading ? 'Fetching…' : 'Fetch /demos/request-id/api'}
  </button>

  {#if fetched}
    <div class="result">
      <code>{fetched}</code>
      <p class="hint">A different id — this fetch is a separate HTTP request, so it gets its own.</p>
    </div>
  {/if}
</div>

<style>
  .fetcher {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: flex-start;
  }

  button {
    padding: 0.55rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    color: var(--text);
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .result {
    width: 100%;
  }

  code {
    display: inline-block;
    font-family: var(--font-mono);
    background: var(--code-bg);
    color: var(--code-accent);
    padding: 0.2rem 0.45rem;
    border-radius: var(--radius-sm);
    font-size: 0.9em;
    word-break: break-all;
  }

  .hint {
    color: var(--text-subtle);
    font-size: 0.9rem;
    margin: 0.5rem 0 0 0;
  }
</style>
