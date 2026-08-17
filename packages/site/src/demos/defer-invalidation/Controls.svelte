<script>
  import { reloadDeferredIsland, reloadDeferredIslandAll, isReloadingDeferredIsland, reloadingDeferredIsland, deferReloads } from 'mochi-framework';
  import { reloads } from './reloadCount.svelte.ts';

  // Reactive: reading `.current` in the markup re-renders the dot when that island starts or
  // stops reloading. The buttons stay clickable so the guard below is still reachable.
  const one = reloadingDeferredIsland('1');
  const pair = reloadingDeferredIsland('2-and-3');

  // One entry per island currently reloading, keyed by the element the event came from —
  // islands sharing a name each get their own, so "reload all" reports the whole batch.
  let active = $state([]);
  let note = $state('');

  // A note answers the click that just happened (ignored, or failed), so it outranks the
  // in-flight text; the next reload that actually starts clears it.
  const status = $derived.by(() => {
    if (note) {
      return note;
    }
    if (active.length === 0) {
      return '';
    }
    const names = [...new Set(active.map((a) => a.name))];
    return names.length === 1 ? `reloading "${names[0]}"…` : `reloading ${active.length} islands…`;
  });

  // The events bubble to the document, so every bit of this status is driven by the islands
  // themselves rather than by the code that started the reload.
  $effect(() => {
    const onStart = (e) => {
      note = '';
      active = [...active, { el: e.target, name: e.detail.name }];
    };
    const onEnd = (e) => {
      reloads.count++;
      active = active.filter((a) => a.el !== e.target);
      if (!e.detail.ok) {
        note = `"${e.detail.name}" failed to reload`;
      }
    };
    document.addEventListener('mochi:island:reloadstart', onStart);
    document.addEventListener('mochi:island:reloadend', onEnd);
    return () => {
      document.removeEventListener('mochi:island:reloadstart', onStart);
      document.removeEventListener('mochi:island:reloadend', onEnd);
    };
  });

  function run(name) {
    // Synchronous, so the handler can bail before starting anything. Click twice quickly to see it.
    if (isReloadingDeferredIsland(name)) {
      note = `"${name}" is already reloading — click ignored`;
      return;
    }
    reloadDeferredIsland(name);
  }
</script>

<div class="controls">
  <div class="buttons">
    <button onclick={() => run('1')}>
      Reload 1
      {#if one.current}<span class="dot" aria-hidden="true"></span>{/if}
    </button>
    <button onclick={() => run('2-and-3')}>
      Reload 2 + 3
      {#if pair.current}<span class="dot" aria-hidden="true"></span>{/if}
    </button>
    <button onclick={() => reloadDeferredIslandAll()}>Reload all</button>
  </div>
  <p class="status" class:empty={status === ''}>{status || ' '}</p>
  <p class="count">Island reloads completed: <strong>{reloads.count}</strong> <span class="via">(counted from mochi:island:reloadend)</span></p>
  <p class="count">
    Shared rune state: <code>deferReloads['1']</code> = <strong>{String(!!deferReloads['1'])}</strong>,
    <code>deferReloads['2-and-3']</code> = <strong>{String(!!deferReloads['2-and-3'])}</strong>
  </p>
</div>

<style>
  .controls {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-bottom: 1rem;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .dot {
    display: inline-block;
    width: 0.5em;
    height: 0.5em;
    margin-left: 0.4em;
    border-radius: 50%;
    background: var(--badge-info-text);
    animation: blink 0.9s ease-in-out infinite;
  }

  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dot {
      animation: none;
    }
  }

  button {
    padding: 0.5rem 0.9rem;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
    cursor: pointer;
  }

  .status {
    margin: 0;
    min-height: 1.2em;
    font-size: 0.85rem;
    font-family: var(--font-mono);
    color: var(--badge-info-text);
  }

  .status.empty {
    visibility: hidden;
  }

  .via {
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: 0.8em;
  }

  .count {
    margin: 0;
    font-size: 0.9rem;
    color: var(--text-subtle);
    font-variant-numeric: tabular-nums;
  }
</style>
