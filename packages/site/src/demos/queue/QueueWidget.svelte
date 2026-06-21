<script lang="ts">
  import { enhance } from 'mochi-framework';
  import type { MochiSubmitFunction } from 'mochi-framework';

  interface ProcessedEntry {
    to: string;
    at: number;
  }

  let pending = $state(0);
  let processed = $state<ProcessedEntry[]>([]);
  let processedTotal = $state(0);
  let lastQueued = $state<string | null>(null);

  async function refresh() {
    const res = await fetch('/demos/queue/status');
    if (!res.ok) {
      return;
    }
    const status = (await res.json()) as { processed: ProcessedEntry[]; processedTotal: number };
    processed = status.processed;
    processedTotal = status.processedTotal;
  }

  $effect(() => {
    refresh();
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  });

  const handleEnqueue: MochiSubmitFunction<{ queued: string; jobId: string }> = () => {
    pending++;
    return ({ result }) => {
      if (result.type === 'success' && result.data) {
        lastQueued = result.data.queued;
      }
      // Give the worker a moment, then reflect the result.
      setTimeout(() => {
        pending = Math.max(0, pending - 1);
        refresh();
      }, 900);
    };
  };
</script>

<div class="queue">
  <form method="POST" action="?/enqueue" {@attach enhance(handleEnqueue)}>
    <label>
      <span>Recipient</span>
      <input type="email" name="to" placeholder="alice@example.com" />
    </label>
    <button type="submit">Enqueue email job</button>
  </form>

  <div class="status">
    <div class="stat">
      <span class="num">{pending}</span>
      <span class="lbl">in flight</span>
    </div>
    <div class="stat">
      <span class="num">{processedTotal}</span>
      <span class="lbl">processed</span>
    </div>
  </div>

  {#if lastQueued}
    <p class="hint">Queued a job for <code>{lastQueued}</code> — the worker picks it up within ~700ms.</p>
  {/if}

  <h3>Recently processed</h3>
  {#if processed.length === 0}
    <p class="empty">No jobs processed yet. Enqueue one above.</p>
  {:else}
    <ul>
      {#each processed as entry (entry.at + entry.to)}
        <li>
          <code>{entry.to}</code>
          <span class="time">{new Date(entry.at).toLocaleTimeString()}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .queue {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-top: 0.75rem;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    align-items: flex-start;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  input {
    padding: 0.5rem 0.7rem;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 1rem;
    width: 16rem;
  }

  button {
    padding: 0.5rem 1rem;
    background: var(--accent);
    color: var(--accent-text);
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
  }

  button:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  .status {
    display: flex;
    gap: 1.5rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.5rem 1rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    min-width: 5rem;
  }

  .num {
    font-size: 1.5rem;
    font-weight: 700;
    font-family: var(--font-mono);
    color: var(--text);
  }

  .lbl {
    font-size: 0.75rem;
    color: var(--text-subtle);
  }

  .hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  h3 {
    margin: 0.5rem 0 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .empty {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-subtle);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.4rem 0.7rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
  }

  .time {
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }

  code {
    background: var(--code-bg);
    color: var(--code-accent);
    padding: 0.05rem 0.35rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }
</style>
