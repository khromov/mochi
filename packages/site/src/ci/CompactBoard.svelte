<script lang="ts">
  import Star from '@lucide/svelte/icons/star';
  import type { CiDashboardData, CiRateLimit } from '../lib/ci';
  import { createCiBoard } from './board.svelte';
  import RunStrip from './RunStrip.svelte';
  import { CI_STARGAZERS_URL } from './repo';
  import { formatRelative, runLabel, runTone, successRate } from './status';
  import type { MochiDirectives } from 'mochi-framework';

  let {
    dashboard,
    rateLimit,
    serverNow,
  }: {
    dashboard: CiDashboardData | null;
    rateLimit: CiRateLimit | null;
    serverNow: number;
  } & MochiDirectives = $props();

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
    <div class="grid">
      {#if board.stars != null}
        <a class="tile tone-neutral stars" href={CI_STARGAZERS_URL} target="_blank" rel="noreferrer">
          <span class="name">{board.stars.toLocaleString()}</span>
          <span class="status"><Star size="1em" aria-hidden="true" /> stars</span>
        </a>
      {/if}
      {#each board.workflows as wf (wf.id)}
        {@const latest = wf.runs[0]}
        {@const rate = successRate(wf.runs)}
        <a class="tile tone-{wf.error ? 'error' : latest ? runTone(latest) : 'neutral'}" href={wf.runsUrl} target="_blank" rel="noreferrer">
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
    /* Same semantic colours as the full board — a failed run is red wherever it shows
       up. The tile itself stays neutral so those squares are the loudest thing on it. */
    --dot-success: var(--badge-success-text);
    --dot-failure: var(--badge-danger-text);
    --dot-running: var(--badge-info-text);
    --dot-neutral: var(--text-subtle);
    --tone: var(--text-muted);
    --tile-bg: var(--surface);
    --dot-ring: var(--tile-bg);
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
    background: var(--tile-bg);
    color: var(--text);
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
    --tone: var(--badge-success-text);
  }

  .tile.tone-running {
    --tone: var(--badge-info-text);
  }

  /* A currently-broken workflow turns the whole tile red — the point of a wall display
     is spotting that from across the room. The tint alone is muted by design, so the
     bright ring carries the rest of the alarm. */
  .tile.tone-failure {
    --tone: var(--badge-danger-text);
    --tile-bg: var(--badge-danger-bg);
    box-shadow: inset 0 0 0 2px var(--badge-danger-text);
  }

  /* "We couldn't ask GitHub" is not "the build is broken" — amber, not red. */
  .tile.tone-error {
    --tone: var(--badge-warning-text);
    --tile-bg: var(--badge-warning-bg);
  }

  .name {
    font-family: var(--font-serif);
    font-size: clamp(1.2rem, 4.4vmin, 3rem);
    font-weight: 500;
    line-height: 1.15;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status {
    font-size: clamp(0.85rem, 2.8vmin, 1.6rem);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--tone);
  }

  .tile.stars {
    --tone: var(--badge-warning-text);
    align-items: center;
    text-align: center;
  }

  .tile.stars .name {
    font-size: clamp(2.5rem, 11vmin, 8rem);
  }

  .tile.stars .status {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    font-size: clamp(1rem, 3.4vmin, 2rem);
  }

  .sub {
    font-size: clamp(0.75rem, 2.1vmin, 1.25rem);
    color: var(--text-subtle);
  }

  .foot {
    margin: 0;
    flex-shrink: 0;
    text-align: center;
    font-size: clamp(0.7rem, 1.9vmin, 1.05rem);
    color: var(--text-subtle);
  }

  .stale {
    color: var(--badge-warning-text);
  }
</style>
