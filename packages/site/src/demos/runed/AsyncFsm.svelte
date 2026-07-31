<script lang="ts">
  import { FiniteStateMachine, resource } from 'runed';
  import { isBrowser } from 'mochi-framework';

  type Light = 'red' | 'yellow' | 'green';
  type LightEvent = 'next';

  // Time spent in each state before auto-advancing.
  const DURATIONS: Record<Light, number> = { red: 3000, green: 3000, yellow: 1200 };

  let auto = $state(true);

  // The FSM fires the initial state's _enter synchronously inside its constructor —
  // before `light` is assigned — so defer the self-referencing debounce to a microtask
  // (and only drive the cycle on the client, never during SSR).
  function scheduleNext(ms: number) {
    if (!isBrowser) {
      return;
    }
    queueMicrotask(() => {
      if (auto) light.debounce(ms, 'next');
    });
  }

  const light = new FiniteStateMachine<Light, LightEvent>('red', {
    red: { next: 'green', _enter: () => scheduleNext(DURATIONS.red) },
    green: { next: 'yellow', _enter: () => scheduleNext(DURATIONS.green) },
    yellow: { next: 'red', _enter: () => scheduleNext(DURATIONS.yellow) },
  });

  function toggleAuto() {
    auto = !auto;
    if (auto) scheduleNext(DURATIONS[light.current]);
  }

  const fruits = ['apple', 'apricot', 'banana', 'blueberry', 'cherry', 'grape', 'lemon', 'mango', 'orange', 'peach', 'pear', 'plum'];

  let query = $state('');
  const search = resource(
    () => query,
    async (q, _prev, { signal }) => {
      const res = await fetch(`/api/runed/search/?q=${encodeURIComponent(q)}`, { signal });
      return (await res.json()) as { matches: string[] };
    },
    { debounce: 300, initialValue: { matches: fruits } },
  );
</script>

<div class="grid">
  <div class="panel">
    <div class="head">
      <h3>FiniteStateMachine</h3>
      <span class="hint">_enter hooks auto-advance via .debounce()</span>
    </div>
    <div class="light" aria-label="traffic light">
      <span class="lamp red" class:on={light.current === 'red'}></span>
      <span class="lamp yellow" class:on={light.current === 'yellow'}></span>
      <span class="lamp green" class:on={light.current === 'green'}></span>
    </div>
    <div class="light-actions">
      <code>{light.current}</code>
      <button onclick={() => light.send('next')}>Next →</button>
      <button onclick={toggleAuto}>{auto ? 'Pause' : 'Resume'}</button>
    </div>
  </div>

  <div class="panel">
    <div class="head">
      <h3>resource</h3>
      <span class="hint">debounced fetch with cancellation</span>
    </div>
    <input type="search" bind:value={query} placeholder="Filter fruits…" />
    <div class="status">
      {#if search.loading}
        <span class="meta">Loading…</span>
      {:else if search.error}
        <span class="meta error">Error: {search.error.message}</span>
      {:else}
        <span class="meta">{search.current?.matches.length ?? 0} match{search.current?.matches.length === 1 ? '' : 'es'}</span>
      {/if}
    </div>
    <div class="matches">
      {#each search.current?.matches ?? [] as fruit (fruit)}
        <span class="chip">{fruit}</span>
      {/each}
    </div>
  </div>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1rem;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
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
    font-size: 0.95rem;
    font-weight: 700;
    margin: 0;
    color: var(--text);
  }

  .hint {
    font-size: 0.75rem;
    color: var(--text-subtle);
  }

  .light {
    display: inline-flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.5rem;
    width: fit-content;
    background: #1a1a1a;
    border-radius: 999px;
  }

  .lamp {
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 50%;
    background: #333;
    opacity: 0.3;
    transition: opacity 0.2s ease;
  }

  .lamp.on {
    opacity: 1;
  }

  .lamp.red {
    background: #ef4444;
  }

  .lamp.yellow {
    background: #f59e0b;
  }

  .lamp.green {
    background: #22c55e;
  }

  .light-actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  input {
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    outline: none;
  }

  input:focus {
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
  }

  button {
    padding: 0.35rem 0.7rem;
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

  .matches {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .chip {
    font-size: 0.8rem;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-muted);
  }

  code {
    background: var(--code-bg);
    color: var(--code-accent);
    font-family: var(--font-mono);
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-size: 0.85rem;
  }

  .meta {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .meta.error {
    color: var(--badge-danger-text);
  }
</style>
