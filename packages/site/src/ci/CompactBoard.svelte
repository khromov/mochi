<script lang="ts">
  import type { CiDashboardData, CiRateLimit } from '../lib/ci';
  import { createCiBoard } from './board.svelte';
  import RunStrip from './RunStrip.svelte';
  import { formatRelative, runLabel, runTone, successRate } from './status';

  let {
    dashboard,
    rateLimit,
    serverNow,
  }: {
    dashboard: CiDashboardData | null;
    rateLimit: CiRateLimit | null;
    serverNow: number;
  } = $props();

  // The seed is deliberately a one-time snapshot: the board owns these values from
  // here on and refreshes them itself.
  // svelte-ignore state_referenced_locally
  const ci = createCiBoard({ dashboard, rateLimit, serverNow });

  const board = $derived(ci.dashboard);
  const now = $derived(ci.now);

  $effect(() => ci.start());
</script>

<div class="wall">
  {#if !board}
    <div class="tile tone-failure solo">
      <span class="name">CI unavailable</span>
      <span class="status">Couldn't reach the GitHub API</span>
    </div>
  {:else}
    <div class="grid" style="--count: {board.workflows.length}">
      {#each board.workflows as wf (wf.id)}
        {@const latest = wf.runs[0]}
        {@const rate = successRate(wf.runs)}
        <a class="tile tone-{wf.error ? 'failure' : latest ? runTone(latest) : 'neutral'}" href={wf.runsUrl} target="_blank" rel="noreferrer">
          <span class="name">{wf.name}</span>
          <span class="status">{wf.error ? 'unavailable' : latest ? runLabel(latest) : 'no runs'}</span>
          {#if latest && !wf.error}
            <span class="sub">{[formatRelative(latest.createdAt, now), rate && `${rate.passed}/${rate.total}`].filter(Boolean).join(' · ')}</span>
            <RunStrip runs={wf.runs} {now} interactive={false} />
          {/if}
        </a>
      {/each}
    </div>

    <p class="foot">
      {board.repo} · {board.branch} · checked {formatRelative(board.fetchedAt, now)}
      {#if ci.failed}<span class="stale">· refresh failed</span>{/if}
    </p>
  {/if}
</div>

<style>
  .wall {
    display: flex;
    flex-direction: column;
    gap: 0.5vmin;
    height: 100dvh;
    padding: 1.2vmin;
    box-sizing: border-box;
    background: var(--bg);
    color: var(--text);
  }

  /* Tracks and type both scale off the viewport, so the same markup reads on a 480px
     panel and a wall-mounted display without a single hard-coded breakpoint. The 28%
     floor caps the grid at three columns however wide it gets — otherwise a desktop
     window flattens every tile into one row of stretched slivers — while the 14rem
     floor takes over on narrow screens and steps down to two columns, then one. */
  .grid {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, max(14rem, 28%)), 1fr));
    grid-auto-rows: 1fr;
    gap: 1.2vmin;
    min-height: 0;
  }

  .tile {
    /* Each tile carries its own tint, so the strip is drawn from currentColor rather
       than the global tone tokens — a green success bar would vanish on a green tile.
       Failures read as the solid marks; passes recede. */
    --dot-success: color-mix(in srgb, currentColor 30%, transparent);
    --dot-failure: currentColor;
    --dot-running: color-mix(in srgb, currentColor 60%, transparent);
    --dot-neutral: color-mix(in srgb, currentColor 15%, transparent);
    --dot-ring: transparent;
    --strip-gap: clamp(2px, 0.6vmin, 5px);
    --bar-size: clamp(9px, 3.1vmin, 24px);
    --bar-radius: clamp(3px, 0.9vmin, 6px);

    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.3vmin;
    padding: 1.5vmin 2vmin;
    border-radius: var(--radius-lg);
    text-decoration: none;
    overflow: hidden;
    background: var(--badge-default-bg);
    color: var(--badge-default-text);
  }

  .tile :global(.strip) {
    margin-top: 0.8vmin;
  }

  .tile.solo {
    flex: 1;
    align-items: center;
    text-align: center;
  }

  .tile.tone-success {
    background: var(--badge-success-bg);
    color: var(--badge-success-text);
  }

  .tile.tone-failure {
    background: var(--badge-danger-bg);
    color: var(--badge-danger-text);
  }

  .tile.tone-running {
    background: var(--badge-info-bg);
    color: var(--badge-info-text);
  }

  .name {
    font-family: var(--font-serif);
    font-size: clamp(1rem, 3.4vmin, 2.1rem);
    font-weight: 500;
    line-height: 1.15;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status {
    font-size: clamp(0.7rem, 2.1vmin, 1.15rem);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .sub {
    font-size: clamp(0.62rem, 1.6vmin, 0.95rem);
    opacity: 0.75;
  }

  .foot {
    margin: 0;
    flex-shrink: 0;
    text-align: center;
    font-size: clamp(0.6rem, 1.5vmin, 0.85rem);
    color: var(--text-subtle);
  }

  .stale {
    color: var(--badge-warning-text);
  }
</style>
