<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';
  import Clock from '@lucide/svelte/icons/clock';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { comparisonOpen, setComparisonOpen } from './comparison.svelte.ts';
  import { rows, rank, type Category, type Status } from './comparisonRows.ts';

  const labelFor: Record<Status, string> = { yes: 'Yes', no: 'No', partial: 'Partial', planned: 'Planned' };

  // `mochi-only` / `kit-only` show features where one framework's support (ranked
  // yes > partial > planned > no) beats the other's, derived from status rather than a per-row tag.
  type Filter = Category | 'all' | 'mochi-only' | 'kit-only';
  const tabs: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'performance', label: 'Performance' },
    { id: 'backend', label: 'Backend' },
    { id: 'frontend', label: 'Frontend' },
    { id: 'mochi-only', label: 'Mochi only' },
    { id: 'kit-only', label: 'SvelteKit only' },
  ];

  let { collapsed: collapsedDefault = false }: { collapsed?: boolean } = $props();

  let activeTab = $state<Filter>('all');
  // Collapsed state lives in a shared store so an external "Expand" link (a separate
  // island) can open this one, falling back to the per-instance `collapsed` prop until the shared value is set.
  const collapsed = $derived(comparisonOpen() === null ? collapsedDefault : !comparisonOpen());
  const filteredRows = $derived.by(() => {
    if (activeTab === 'all') {
      return rows;
    }
    if (activeTab === 'mochi-only') {
      return rows.filter((row) => rank[row.mochi.status] > rank[row.kit.status]);
    }
    if (activeTab === 'kit-only') {
      return rows.filter((row) => rank[row.kit.status] > rank[row.mochi.status]);
    }
    return rows.filter((row) => row.tags.includes(activeTab));
  });
  // Collapsed preview renders only the header row (no body rows).
  const visibleRows = $derived(collapsed ? [] : filteredRows);
</script>

<div class="table-header">
  <div class="tabs-scroll">
    <div class="tabs" role="tablist" aria-label="Filter features">
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
  <button type="button" class="collapse-btn" aria-expanded={!collapsed} onclick={() => setComparisonOpen(collapsed)}>
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
              <span class="col-label" aria-hidden="true">{i === 0 ? 'Mochi' : 'SvelteKit'}</span>
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

  /* `overflow-x: auto` means the scrollbar only shows when pills overflow, and the
     thumb stays transparent until hover so it's never visually noisy. */
  .tabs-scroll {
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 22px), transparent);
    mask-image: linear-gradient(to right, #000 calc(100% - 22px), transparent);
  }
  .tabs-scroll:hover {
    scrollbar-color: var(--border-strong) transparent;
  }
  .tabs-scroll::-webkit-scrollbar {
    height: 8px;
  }
  .tabs-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  /* Transparent 2px border + padding-box clip insets the thumb so it floats
     with a little breathing room rather than touching the edges. */
  .tabs-scroll::-webkit-scrollbar-thumb {
    background: transparent;
    border: 2px solid transparent;
    background-clip: padding-box;
    border-radius: 999px;
  }
  .tabs-scroll:hover::-webkit-scrollbar-thumb {
    background: var(--border-strong);
    background-clip: padding-box;
  }
  .tabs-scroll:hover::-webkit-scrollbar-thumb:hover {
    background: var(--text-subtle);
  }

  .tabs {
    display: flex;
    flex-wrap: nowrap;
    gap: 0.4rem;
    padding-right: 22px;
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

  .tab {
    flex-shrink: 0;
    white-space: nowrap;
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

  .tab:not(:disabled):not(.active):hover {
    border-color: var(--accent);
    color: var(--text);
  }

  .tab.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }

  .tab.active:not(:disabled):hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
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

  .comparison .comparison-table {
    border-collapse: collapse;
    margin: 0;
    font-family: var(--font-sans);
    font-size: 0.95rem;
    color: var(--text);
  }

  /* Keep a comfortable min width so wide content scrolls horizontally on mobile
     (via .comparison's overflow-x) rather than squishing into the viewport width. */
  .comparison:not(.preview) .comparison-table {
    min-width: 36rem;
  }

  /* Force a real fixed-layout, full-width table (out-specifying the global
     `.readme table { display: block }`) so the header fills 100% with no body rows — must
     stay scoped to preview, or fixed layout squishes columns on the expanded table's mobile view. */
  .comparison.preview .comparison-table {
    display: table !important;
    width: 100% !important;
    table-layout: fixed !important;
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

  /* Redundant on desktop since thead already labels columns; declared before the
     media query below so the mobile override wins on source order. */
  .col-label {
    display: none;
  }

  /* Scoped to :not(.preview) so the collapsed preview keeps its fixed-layout faded header row. */
  @media (max-width: 640px) {
    .comparison:not(.preview) .comparison-table {
      min-width: 0;
      display: block;
      width: 100%;
    }

    .comparison:not(.preview) thead {
      display: none;
    }

    .comparison:not(.preview) tbody {
      display: block;
    }

    .comparison:not(.preview) tbody tr {
      display: grid;
      grid-template-columns: 1fr 1fr;
      border-bottom: 1px solid var(--border);
    }

    .comparison:not(.preview) tbody tr:last-child {
      border-bottom: none;
    }

    /* Flush two-up columns split by a single gray divider, no gutter gap. */
    .comparison:not(.preview) td + td {
      border-left: 1px solid var(--border);
    }

    .comparison:not(.preview) .feature-col {
      grid-column: 1 / -1;
      width: auto;
      background: var(--surface-muted);
      font-weight: 600;
      text-align: center;
    }

    .comparison:not(.preview) td {
      border-bottom: none;
      text-align: center;
    }

    .comparison:not(.preview) .col-label {
      display: block;
      margin-bottom: 0.2rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
      text-align: center;
    }
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
