<script lang="ts">
  import type { TaskStatus, TaskTick } from './types.ts';

  let { initial }: { initial: TaskStatus } = $props();

  // Seeded from the serverProps snapshot; the SSE stream then owns them.
  // svelte-ignore state_referenced_locally
  let ticks = $state<TaskTick[]>(initial.ticks);
  // svelte-ignore state_referenced_locally
  let total = $state(initial.total);
  // svelte-ignore state_referenced_locally
  let nextRun = $state<number | null>(initial.nextRun);
  let now = $state(Date.now());

  $effect(() => {
    const source = new EventSource('/demos/tasks/events/');
    source.addEventListener('message', (e) => {
      const status = JSON.parse(e.data) as TaskStatus;
      ticks = status.ticks;
      total = status.total;
      nextRun = status.nextRun;
    });

    // Drives the countdown only — the schedule itself lives entirely on the server.
    const clock = setInterval(() => {
      now = Date.now();
    }, 200);

    const close = () => source.close();
    window.addEventListener('pagehide', close);
    return () => {
      window.removeEventListener('pagehide', close);
      clearInterval(clock);
      close();
    };
  });

  const countdown = $derived(nextRun === null ? null : Math.max(0, nextRun - now));
</script>

<div class="task">
  <div class="status">
    <div class="stat">
      <span class="num">{total}</span>
      <span class="lbl">runs</span>
    </div>
    <div class="stat">
      <span class="num">{countdown === null ? '—' : `${(countdown / 1000).toFixed(1)}s`}</span>
      <span class="lbl">until next run</span>
    </div>
  </div>

  <h3>Recent ticks</h3>
  {#if ticks.length === 0}
    <p class="empty">No ticks yet — the first one lands within five seconds.</p>
  {:else}
    <ul>
      {#each ticks as tick (tick.sequence)}
        <li>
          <code>#{tick.sequence}</code>
          <span class="time">{new Date(tick.at).toLocaleTimeString()}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .task {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-top: 0.75rem;
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
    min-width: 7rem;
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
