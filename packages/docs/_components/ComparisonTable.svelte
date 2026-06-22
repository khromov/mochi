<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';
  import Clock from '@lucide/svelte/icons/clock';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';

  type Status = 'yes' | 'no' | 'partial' | 'planned';
  type Category = 'performance' | 'backend' | 'frontend';
  interface Cell {
    status: Status;
    note?: string;
    href?: string;
  }
  interface Row {
    feature: string;
    tags: Category[];
    mochi: Cell;
    kit: Cell;
  }

  const rows: Row[] = [
    {
      feature: 'Server islands / selective hydration',
      tags: ['performance', 'frontend'],
      mochi: { status: 'yes', note: 'mochi:defer', href: '/docs/server-islands/' },
      kit: { status: 'no', note: 'full page hydration only' },
    },
    {
      feature: 'Built-in SQLite database',
      tags: ['backend'],
      mochi: { status: 'yes', note: 'bun:sqlite', href: 'https://bun.com/docs/api/sqlite' },
      kit: { status: 'partial', note: 'Only with adapter-node' },
    },
    {
      feature: 'Built-in Postgres & MySQL support',
      tags: ['backend'],
      mochi: { status: 'yes', note: 'Bun.sql()', href: 'https://bun.com/docs/api/sql' },
      kit: { status: 'no', note: 'bring your own cloud database' },
    },
    {
      feature: 'Background job queues',
      tags: ['backend'],
      mochi: { status: 'yes', note: 'Mochi.queue()', href: '/docs/queues/' },
      kit: { status: 'no' },
    },
    {
      feature: 'JavaScript bundle size optimization',
      tags: ['performance', 'frontend'],
      mochi: { status: 'yes', note: 'optimized for first page load' },
      kit: { status: 'partial', note: 'optimized for several page views; slightly larger on first load' },
    },
    {
      feature: 'Smallest amount of JavaScript on load',
      tags: ['performance', 'frontend'],
      mochi: { status: 'yes', note: 'zero JS unless hydrated' },
      kit: { status: 'no', note: 'only global JS opt-out which leaves app non-functioning', href: 'https://svelte.dev/docs/kit/glossary#CSR' },
    },
    {
      feature: 'Deployment targets',
      tags: ['backend'],
      mochi: { status: 'no', note: 'Bun only' },
      kit: { status: 'yes', note: 'Node, Vercel, Bun and other cloud providers' },
    },
    { feature: 'Client-side router (goto / invalidate)', tags: ['frontend'], mochi: { status: 'no' }, kit: { status: 'yes' } },
    { feature: 'Prerendering / SSG', tags: ['performance', 'frontend'], mochi: { status: 'partial', note: 'warmup pre-render' }, kit: { status: 'yes' } },
    { feature: 'Form actions + progressively enhanced forms', tags: ['backend', 'frontend'], mochi: { status: 'yes' }, kit: { status: 'yes' } },
    { feature: 'Middleware', tags: ['backend'], mochi: { status: 'yes' }, kit: { status: 'yes' } },
    {
      feature: 'Hooks & extension filters',
      tags: ['backend'],
      mochi: { status: 'yes', note: 'eventHooks & filters', href: '/docs/extensions/' },
      kit: { status: 'no' },
    },
    { feature: 'Top-level await', tags: ['backend', 'frontend'], mochi: { status: 'yes' }, kit: { status: 'partial', note: 'experimental' } },
    {
      feature: 'Real-time WebSockets',
      tags: ['backend'],
      mochi: { status: 'yes', note: 'Mochi.ws()', href: '/docs/websocket-routes/' },
      kit: { status: 'no', note: 'custom server with external package' },
    },
    {
      feature: 'Server-Sent Events',
      tags: ['backend'],
      mochi: { status: 'yes', note: 'Mochi.sse()', href: '/docs/server-sent-events/' },
      kit: { status: 'no', note: 'manual setup' },
    },
    {
      feature: 'Built-in caching library',
      tags: ['performance', 'backend'],
      mochi: { status: 'yes', note: 'MochiCache', href: '/docs/cache/' },
      kit: { status: 'no' },
    },
    { feature: 'Cookie helpers', tags: ['backend'], mochi: { status: 'yes' }, kit: { status: 'yes' } },
    { feature: 'Remote functions (type-safe RPC)', tags: ['backend', 'frontend'], mochi: { status: 'no' }, kit: { status: 'yes', note: 'experimental' } },
    {
      feature: 'View Transitions',
      tags: ['frontend'],
      mochi: { status: 'yes', note: 'built-in component', href: '/docs/view-transitions/' },
      kit: { status: 'partial', note: 'manual wiring', href: 'https://svelte.dev/blog/view-transitions' },
    },
    { feature: 'Tailwind', tags: ['frontend'], mochi: { status: 'yes', note: 'Tailwind v4', href: '/docs/tailwind/' }, kit: { status: 'yes' } },
    {
      feature: 'Centralized logging system',
      tags: ['backend'],
      mochi: { status: 'yes', note: 'mochiEvents', href: '/docs/events/' },
      kit: { status: 'no', note: 'experimental OpenTelemetry only' },
    },
    {
      feature: 'Image resizing',
      tags: ['performance', 'frontend'],
      mochi: { status: 'planned', note: 'build & runtime transformations' },
      kit: { status: 'partial', note: 'build-time only; runtime at extra cost' },
    },
    { feature: 'Link preloading', tags: ['performance', 'frontend'], mochi: { status: 'planned' }, kit: { status: 'yes' } },
    { feature: 'Service worker integration', tags: ['performance', 'frontend'], mochi: { status: 'planned' }, kit: { status: 'yes' } },
    { feature: 'Snapshots', tags: ['frontend'], mochi: { status: 'partial', note: 'browser-native restoration' }, kit: { status: 'yes', note: 'manual setup' } },
  ];

  const labelFor: Record<Status, string> = { yes: 'Yes', no: 'No', partial: 'Partial', planned: 'Planned' };

  const tabs: { id: Category | 'all'; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'performance', label: 'Performance' },
    { id: 'backend', label: 'Backend' },
    { id: 'frontend', label: 'Frontend' },
  ];

  let { collapsed: collapsedDefault = false }: { collapsed?: boolean } = $props();

  let activeTab = $state<Category | 'all'>('all');
  // `collapsed` starts from the prop and falls back to the user's toggle once they click.
  let userToggled = $state<boolean | null>(null);
  const collapsed = $derived(userToggled ?? collapsedDefault);
  const filteredRows = $derived(activeTab === 'all' ? rows : rows.filter((row) => row.tags.includes(activeTab)));
  // Collapsed preview renders only the header row (no body rows).
  const visibleRows = $derived(collapsed ? [] : filteredRows);
</script>

<div class="table-header">
  <div class="tabs-scroll">
    <div class="tabs" role="tablist" aria-label="Filter features by area">
      {#each tabs as tab (tab.id)}
        <button
          type="button"
          role="tab"
          class="tab"
          class:active={activeTab === tab.id}
          aria-selected={activeTab === tab.id}
          disabled={collapsed}
          onclick={() => (activeTab = tab.id)}>{tab.label}</button
        >
      {/each}
    </div>
  </div>
  <button type="button" class="collapse-btn" aria-expanded={!collapsed} onclick={() => (userToggled = !collapsed)}>
    {#if collapsed}
      Expand <ChevronDown size={16} aria-hidden="true" />
    {:else}
      Collapse <ChevronUp size={16} aria-hidden="true" />
    {/if}
  </button>
</div>

<div class="comparison" class:preview={collapsed} aria-hidden={collapsed}>
  <table class="comparison-table">
    <thead>
      <tr>
        <th scope="col" class="feature-col">Feature</th>
        <th scope="col">Mochi</th>
        <th scope="col">SvelteKit</th>
      </tr>
    </thead>
    <tbody>
      {#each visibleRows as row (row.feature)}
        <tr>
          <th scope="row" class="feature-col">{row.feature}</th>
          {#each [row.mochi, row.kit] as cell, i (i)}
            <td>
              <span class="cell {cell.status}">
                {#if cell.status === 'partial'}
                  <span class="tilde" aria-hidden="true">~</span>
                {:else if cell.status === 'yes'}
                  <Check class="cell-icon" size={22} aria-hidden="true" />
                {:else if cell.status === 'planned'}
                  <Clock class="cell-icon" size={22} aria-hidden="true" />
                {:else}
                  <X class="cell-icon" size={22} aria-hidden="true" />
                {/if}
                <span class="label"
                  >{labelFor[cell.status]}{#if cell.note}<span class="note"
                      >&nbsp;-&nbsp;{#if cell.href}<a href={cell.href} target="_blank" rel="noopener noreferrer">{cell.note}</a>{:else}{cell.note}{/if}</span
                    >{/if}</span
                >
              </span>
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .table-header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 1.5rem 0 0.6rem;
  }

  .tabs-scroll {
    flex: 1 1 auto;
    min-width: 0;
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .collapse-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-family: var(--font-sans);
    font-size: 0.875rem;
    font-weight: 500;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      color 0.15s ease;
  }

  .collapse-btn:hover {
    border-color: var(--accent);
    color: var(--text);
  }

  /* On narrow screens the filter pills scroll horizontally behind a right-edge
     fade; the collapse button stays pinned outside the scroll area. */
  @media (max-width: 640px) {
    .tabs-scroll {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 22px), transparent);
      mask-image: linear-gradient(to right, #000 calc(100% - 22px), transparent);
    }
    .tabs-scroll::-webkit-scrollbar {
      display: none;
    }
    .tabs {
      flex-wrap: nowrap;
      padding-right: 22px;
    }
    .tab {
      flex-shrink: 0;
      white-space: nowrap;
    }
  }

  .tab {
    font-family: var(--font-sans);
    font-size: 0.875rem;
    font-weight: 500;
    padding: 0.3rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease,
      border-color 0.15s ease;
  }

  .tab:not(:disabled):hover {
    border-color: var(--accent);
    color: var(--text);
  }

  .tab.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .tab:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .comparison {
    margin: 0 0 1.25rem;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  /* Collapsed: render only the header row and fade it out top-to-bottom. */
  .comparison.preview {
    overflow: hidden;
    pointer-events: none;
    -webkit-mask-image: linear-gradient(to bottom, #000 20%, transparent);
    mask-image: linear-gradient(to bottom, #000 20%, transparent);
  }

  /* Fixed layout in both states so columns keep identical proportions and the
     header never reflows when the body rows are removed on collapse. */
  .comparison-table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    margin: 0;
    font-family: var(--font-sans);
    font-size: 0.95rem;
    color: var(--text);
  }

  .comparison-table th,
  .comparison-table td {
    padding: 0.5rem 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }

  .comparison-table thead th {
    background: var(--surface-muted);
    font-weight: 600;
    white-space: nowrap;
  }

  .feature-col {
    font-weight: 500;
    color: var(--text);
    width: 42%;
  }

  .comparison-table tbody tr:last-child th,
  .comparison-table tbody tr:last-child td {
    border-bottom: none;
  }

  .cell {
    display: inline-flex;
    align-items: flex-start;
    gap: 0.4rem;
  }

  .cell :global(.cell-icon) {
    flex-shrink: 0;
  }

  .tilde {
    flex-shrink: 0;
    margin-top: 1px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 19px;
    height: 19px;
    border-radius: 50%;
    background: #e07b2c;
    color: #fff;
    font-weight: 700;
    font-size: 1.1rem;
    line-height: 1;
  }

  .label {
    font-weight: 500;
    line-height: 22px;
  }

  .note {
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: 400;
  }

  .note a {
    color: var(--accent);
    text-decoration: none;
  }
  .note a:hover {
    text-decoration: underline;
  }

  .cell.yes :global(.cell-icon) {
    color: var(--accent);
  }
  .cell.no :global(.cell-icon) {
    color: var(--badge-danger-text);
  }
  .cell.planned :global(.cell-icon) {
    color: var(--badge-tip-text);
  }
</style>
