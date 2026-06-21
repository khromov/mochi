<script lang="ts">
  import { enhance } from 'mochi-framework';
  import type { MochiSubmitFunction } from 'mochi-framework';
  import type { ProcessedEntry, QueueStatus } from './queue.ts';

  let { initial }: { initial: QueueStatus } = $props();

  let pending = $state(0);
  // Seed mutable local state from the serverProps snapshot; the SSE stream owns it after.
  // svelte-ignore state_referenced_locally
  let processed = $state<ProcessedEntry[]>(initial.processed);
  // svelte-ignore state_referenced_locally
  let processedTotal = $state(initial.processedTotal);
  let lastQueued = $state<string | null>(null);

  // Initial state arrives via serverProps; the SSE stream pushes a fresh status
  // every time a job completes — no polling.
  $effect(() => {
    const source = new EventSource('/demos/queue/events/');
    source.addEventListener('message', (e) => {
      const status = JSON.parse(e.data) as QueueStatus;
      const advanced = status.processedTotal - processedTotal;
      if (advanced > 0) {
        pending = Math.max(0, pending - advanced);
      }
      processed = status.processed;
      processedTotal = status.processedTotal;
    });

    const close = () => source.close();
    window.addEventListener('pagehide', close);
    return () => {
      window.removeEventListener('pagehide', close);
      close();
    };
  });

  const handleEnqueue: MochiSubmitFunction<{ queued: string; jobId: string }> = () => {
    pending++;
    return ({ result }) => {
      if (result.type === 'success' && result.data) {
        lastQueued = result.data.queued;
      } else {
        pending = Math.max(0, pending - 1);
      }
    };
  };
</script>

<div class="queue">
  <form method="POST" action="?/enqueue" {@attach enhance(handleEnqueue)}>
    <label>
      <span>Username</span>
      <input type="text" name="username" placeholder="alice" autocomplete="off" />
    </label>
    <button type="submit">Enqueue notification</button>
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
    <p class="hint">Queued a notification for <code>{lastQueued}</code> — the worker picks it up within ~700ms.</p>
  {/if}

  <h3>Recently processed</h3>
  {#if processed.length === 0}
    <p class="empty">No notifications processed yet. Enqueue one above.</p>
  {:else}
    <ul>
      <!-- {entry.user} is free-text from the user; Svelte escapes it on render, so it's XSS-safe. -->
      {#each processed as entry (entry.at + entry.user)}
        <li>
          <code>{entry.user}</code>
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
