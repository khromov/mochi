<script lang="ts">
  import type { CiRun } from '../lib/ci';
  import { formatRelative, runLabel, runTone } from './status';

  // `interactive: false` renders spans instead of links — the compact board wraps each
  // whole tile in an <a>, and nesting anchors is invalid HTML.
  let { runs, now, interactive = true }: { runs: CiRun[]; now: number; interactive?: boolean } = $props();

  // Runs arrive newest-first; read left-to-right as oldest-to-newest.
  const ordered = $derived([...runs].reverse());
</script>

<div class="strip">
  {#each ordered as run (run.id)}
    {@const label = `#${run.runNumber} · ${runLabel(run)} · ${formatRelative(run.createdAt, now)}`}
    <svelte:element
      this={interactive ? 'a' : 'span'}
      class="bar tone-{runTone(run)}"
      class:live={run.status !== 'completed'}
      href={interactive ? run.htmlUrl : undefined}
      target={interactive ? '_blank' : undefined}
      rel={interactive ? 'noreferrer' : undefined}
      role={interactive ? undefined : 'img'}
      title={label}
      aria-label={label}
    ></svelte:element>
  {/each}
</div>

<style>
  /* Squares at a fixed size rather than blobs that stretch to fill: a workflow with
     seven runs would otherwise draw visibly fatter squares than one with ten, which
     reads as meaning something it doesn't. */
  .strip {
    display: flex;
    align-items: center;
    gap: var(--strip-gap, 4px);
    overflow: hidden;
  }

  .bar {
    /* Shrinkable rather than fixed: in a tall, narrow column the full-size strip would
       overrun its tile and `overflow: hidden` would quietly eat the newest runs. */
    flex: 0 1 auto;
    width: var(--bar-size, 22px);
    min-width: 3px;
    aspect-ratio: 1;
    border-radius: var(--bar-radius, 5px);
    background: var(--dot-neutral);
    text-decoration: none;
    transition: transform 0.12s ease;
  }

  a.bar:hover,
  a.bar:focus-visible {
    transform: scale(1.12);
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .bar.tone-success {
    background: var(--dot-success);
  }

  .bar.tone-running {
    background: var(--dot-running);
  }

  /* An inset notch so a failure is distinguishable from a pass without relying on hue.
     It has to match whatever the bar sits on, so the host overrides --dot-ring: the
     compact board's failed tiles are tinted, where the --surface default would read as
     a stray light square. */
  .bar.tone-failure {
    background: var(--dot-failure);
    box-shadow: inset 0 0 0 2px var(--dot-ring, var(--surface));
  }

  @media (prefers-reduced-motion: no-preference) {
    .bar.live {
      animation: pulse 1.4s ease-in-out infinite;
    }
  }

  @keyframes pulse {
    50% {
      opacity: 0.4;
    }
  }
</style>
