<script lang="ts">
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import type { CiDashboardData, CiRateLimit } from '../lib/ci';
  import { createCiBoard } from './board.svelte';
  import { CI_ACTIONS_URL } from './repo';
  import WorkflowCard from './WorkflowCard.svelte';
  import { formatRelative, formatUntil } from './status';

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
  const limit = $derived(ci.rateLimit);
  const now = $derived(ci.now);

  $effect(() => ci.start());
</script>

<div class="toolbar">
  <p class="checked">
    {#if board}
      Checked {formatRelative(board.fetchedAt, now)}
    {:else}
      Not loaded
    {/if}
    {#if ci.failed}
      <span class="chip">refresh failed</span>
    {/if}
  </p>

  <div class="toolbar-right">
    {#if limit}
      <span class="quota">{limit.remaining}/{limit.limit} API calls left · resets {formatUntil(limit.resetAt, now)}</span>
    {/if}
    <button type="button" onclick={() => void ci.refresh()} disabled={ci.polling} aria-label="Refresh now">
      <span class="spin" class:spinning={ci.polling}><RefreshCw size={14} aria-hidden="true" /></span>
      Refresh
    </button>
  </div>
</div>

{#if !board}
  <div class="notice">
    <p class="notice-title"><TriangleAlert size={16} aria-hidden="true" /> Couldn't load the CI status</p>
    {#if limit && limit.remaining === 0}
      <p>GitHub's unauthenticated API allowance ({limit.limit} requests/hour) is used up. It resets {formatUntil(limit.resetAt, now)}.</p>
    {:else}
      <p>The GitHub API didn't respond. This page will retry on its own.</p>
    {/if}
    <p><a href={CI_ACTIONS_URL} target="_blank" rel="noreferrer">Open the Actions tab on GitHub →</a></p>
  </div>
{:else}
  {#if board.partial}
    <p class="warn"><TriangleAlert size={14} aria-hidden="true" /> Some workflows couldn't be loaded — the rest are up to date.</p>
  {/if}

  <div class="grid">
    {#each board.workflows as workflow (workflow.id)}
      <WorkflowCard {workflow} branch={board.branch} {now} />
    {/each}
  </div>
{/if}

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .checked {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .quota {
    font-size: 0.75rem;
    color: var(--text-subtle);
  }

  .chip {
    margin-left: 0.4rem;
    padding: 0.1em 0.5em;
    border-radius: 999px;
    background: var(--badge-warning-bg);
    color: var(--badge-warning-text);
    font-size: 0.7rem;
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.7rem;
    font: inherit;
    font-size: 0.8rem;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: var(--surface-muted);
    border-color: var(--border-strong);
  }

  button:disabled {
    cursor: default;
    color: var(--text-subtle);
  }

  .spin {
    display: inline-flex;
  }

  @media (prefers-reduced-motion: no-preference) {
    .spin.spinning {
      animation: rotate 0.9s linear infinite;
    }
  }

  @keyframes rotate {
    to {
      transform: rotate(360deg);
    }
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1rem;
  }

  .notice {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    padding: 1.25rem 1.5rem;
    color: var(--text-muted);
  }

  .notice p {
    margin: 0 0 0.5rem;
  }

  .notice p:last-child {
    margin-bottom: 0;
  }

  .notice-title {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-weight: 600;
    color: var(--text);
  }

  .warn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0 0 1rem;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-md);
    background: var(--badge-warning-bg);
    color: var(--badge-warning-text);
    font-size: 0.85rem;
  }

  @media (max-width: 768px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
