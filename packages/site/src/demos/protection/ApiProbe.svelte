<script lang="ts">
  let status = $state<number | null>(null);
  let body = $state('');
  let busy = $state(false);

  async function probe() {
    busy = true;
    try {
      const res = await fetch('/demos/protection/api/');
      status = res.status;
      body = await res.text();
    } catch (e) {
      status = null;
      body = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="probe">
  <button type="button" onclick={probe} disabled={busy}>Call the protected API</button>
  {#if status !== null || body}
    <pre class:blocked={status !== 200}>{status ?? 'error'} — {body}</pre>
  {/if}
</div>

<style>
  .probe {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  button {
    align-self: flex-start;
    padding: 0.4rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.6;
    cursor: wait;
  }

  pre {
    margin: 0;
    padding: 0.6rem 0.8rem;
    border-radius: var(--radius-sm);
    background: var(--code-bg);
    color: var(--code-accent);
    font-family: var(--font-mono);
    font-size: 0.8rem;
    white-space: pre-wrap;
    word-break: break-word;
  }

  pre.blocked {
    color: var(--text-muted);
  }
</style>
