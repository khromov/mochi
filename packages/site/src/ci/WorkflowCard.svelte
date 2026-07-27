<script lang="ts">
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Badge from '../components/Badge.svelte';
  import type { CiWorkflow } from '../lib/ci';
  import RunStrip from './RunStrip.svelte';
  import { formatRelative, runLabel, runTone, successRate, toneToBadge } from './status';

  let { workflow, branch, now }: { workflow: CiWorkflow; branch: string; now: number } = $props();

  const latest = $derived(workflow.runs[0]);
  const rate = $derived(successRate(workflow.runs));
</script>

<article class="card">
  <header>
    <a class="name" href={workflow.runsUrl} target="_blank" rel="noreferrer">{workflow.name}</a>
    {#if workflow.error}
      <Badge kind="warning">Unavailable</Badge>
    {:else if latest}
      <Badge kind={toneToBadge[runTone(latest)]}>{runLabel(latest)}</Badge>
    {/if}
  </header>
  <p class="path">{workflow.path}</p>

  {#if workflow.error}
    <p class="empty"><TriangleAlert size={14} aria-hidden="true" /> Couldn't load runs for this workflow.</p>
  {:else if latest}
    <a class="latest" href={latest.htmlUrl} target="_blank" rel="noreferrer">
      <span class="title">{latest.title}</span>
      <span class="meta">
        <span class="num">#{latest.runNumber}</span>
        <span class="sha">{latest.sha}</span>
        <span>{latest.event}</span>
        <span>{formatRelative(latest.createdAt, now)}</span>
      </span>
    </a>

    <RunStrip runs={workflow.runs} {now} />
    {#if rate}
      <p class="rate">{rate.passed}/{rate.total} passing on {branch}</p>
    {/if}
  {/if}
</article>

<style>
  .card {
    /* Map tones once here. The --badge-*-bg fills are too pale to read as a bar on
       --surface, but the matching *-text tokens carry contrast in both themes. */
    --dot-success: var(--badge-success-text);
    --dot-failure: var(--badge-danger-text);
    --dot-running: var(--badge-info-text);
    --dot-neutral: var(--text-subtle);

    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    padding: 1rem 1.15rem 1.1rem;
    color: var(--text);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .name {
    font-family: var(--font-serif);
    font-size: 1.15rem;
    font-weight: 500;
    color: var(--text);
    text-decoration: none;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name:hover {
    color: var(--accent-hover);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .path {
    margin: -0.35rem 0 0.15rem;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--text-subtle);
  }

  .latest {
    display: block;
    padding: 0.5rem 0.6rem;
    margin: 0 -0.15rem;
    border-radius: var(--radius-md);
    color: inherit;
    text-decoration: none;
  }

  .latest:hover {
    background: var(--surface-muted);
  }

  .title {
    display: block;
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 0.2rem;
    font-size: 0.75rem;
    color: var(--text-subtle);
  }

  .num,
  .sha {
    font-family: var(--font-mono);
  }

  .rate {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-subtle);
  }

  .empty {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0.15rem 0 0;
    font-size: 0.85rem;
    color: var(--text-muted);
  }
</style>
