<script lang="ts">
  import { enhance } from 'mochi-framework';
  import type { QueueAdvancedStatus, DemoLogEntry } from './types.ts';

  let { initial }: { initial: QueueAdvancedStatus } = $props();

  // Seed from the serverProps snapshot; the SSE stream then owns this server-global state.
  // svelte-ignore state_referenced_locally
  let storage = $state(initial.storage);
  // svelte-ignore state_referenced_locally
  let dlqDepth = $state(initial.dlqDepth);
  // svelte-ignore state_referenced_locally
  let log = $state<DemoLogEntry[]>(initial.log);

  $effect(() => {
    const source = new EventSource('/demos/queue-advanced/events/');
    source.addEventListener('message', (e) => {
      const status = JSON.parse(e.data) as QueueAdvancedStatus;
      storage = status.storage;
      dlqDepth = status.dlqDepth;
      log = status.log;
    });

    const close = () => source.close();
    window.addEventListener('pagehide', close);
    return () => {
      window.removeEventListener('pagehide', close);
      close();
    };
  });

  const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour12: false });
</script>

<div class="advanced">
  <div class="meta">
    <span class="badge">storage: <code>{storage}</code></span>
    <span class="badge" class:alert={dlqDepth > 0}>dead-letter depth: <code>{dlqDepth}</code></span>
    <form method="POST" action="?/redrive" {@attach enhance()}>
      <button type="submit" class="secondary" disabled={dlqDepth === 0}>Redrive DLQ</button>
    </form>
  </div>

  <div class="buttons">
    <form method="POST" action="?/deliver" {@attach enhance()}>
      <input type="hidden" name="mode" value="ok" />
      <button type="submit">Deliver (succeeds)</button>
    </form>
    <form method="POST" action="?/deliver" {@attach enhance()}>
      <input type="hidden" name="mode" value="flaky" />
      <button type="submit">Flaky (fails once, then succeeds)</button>
    </form>
    <form method="POST" action="?/deliver" {@attach enhance()}>
      <input type="hidden" name="mode" value="doomed" />
      <button type="submit">Doomed (retries out → DLQ)</button>
    </form>
    <form method="POST" action="?/delayed" {@attach enhance()}>
      <button type="submit">Deferred (startAfter: 5)</button>
    </form>
    <form method="POST" action="?/priorityBatch" {@attach enhance()}>
      <button type="submit">Priority batch (0/1/5/10)</button>
    </form>
    <form method="POST" action="?/throttled" {@attach enhance()}>
      <button type="submit">Throttled (10s slot)</button>
    </form>
    <form method="POST" action="?/debounced" {@attach enhance()}>
      <button type="submit">Debounced (10s slot)</button>
    </form>
  </div>

  <h3>Live event log</h3>
  {#if log.length === 0}
    <p class="empty">Nothing yet — enqueue something above and watch the lifecycle stream in.</p>
  {:else}
    <ul>
      {#each log as entry (entry.id)}
        <li>
          <span class="tag {entry.kind}">{entry.kind}</span>
          <span class="line">
            <code>{entry.queue}</code>{#if entry.jobId}&nbsp;<span class="job">#{entry.jobId.slice(0, 8)}</span>{/if}{#if entry.attempt}&nbsp;<span class="attempt"
                >attempt {entry.attempt}</span
              >{/if}
            <span class="detail">{entry.detail}</span>
          </span>
          <span class="time">{time(entry.at)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .advanced {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-top: 0.75rem;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .badge {
    padding: 0.35rem 0.7rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .badge.alert {
    border-color: var(--accent);
  }

  .buttons {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  button {
    padding: 0.45rem 0.85rem;
    background: var(--accent);
    color: var(--accent-text);
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  button:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  button.secondary {
    background: var(--surface);
    color: var(--text);
    border-color: var(--border);
  }

  button.secondary:disabled {
    opacity: 0.5;
    cursor: default;
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
    gap: 0.3rem;
    max-height: 24rem;
    overflow-y: auto;
  }

  li {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.35rem 0.7rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.82rem;
  }

  .tag {
    flex-shrink: 0;
    min-width: 5.5rem;
    text-align: center;
    padding: 0.1rem 0.4rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.72rem;
    background: var(--code-bg);
    color: var(--text-muted);
  }

  .tag.completed {
    color: var(--success, #22c55e);
  }

  .tag.failed,
  .tag.dlq {
    color: var(--danger, #ef4444);
  }

  .tag.active {
    color: var(--code-accent);
  }

  .tag.suppressed,
  .tag.redrive,
  .tag.info {
    color: var(--warning, #eab308);
  }

  .line {
    flex: 1;
    min-width: 0;
  }

  .detail {
    color: var(--text-muted);
    margin-left: 0.4rem;
  }

  .job,
  .attempt {
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: 0.78rem;
  }

  .time {
    flex-shrink: 0;
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: 0.75rem;
  }

  code {
    background: var(--code-bg);
    color: var(--code-accent);
    padding: 0.05rem 0.35rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }
</style>
