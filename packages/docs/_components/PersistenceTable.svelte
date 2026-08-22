<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';
  import Clock from '@lucide/svelte/icons/clock';
  import { persistenceRows, type Cell } from './persistence.ts';

  let { feature }: { feature?: string } = $props();

  const rows = $derived(feature ? persistenceRows.filter((r) => r.key === feature) : persistenceRows);
  const compact = $derived(Boolean(feature));

  const labelFor: Record<Cell['status'], string> = { yes: 'supported', no: 'not supported', planned: 'planned' };

  const columns: { label: string; pick: (row: (typeof persistenceRows)[number]) => Cell }[] = [
    { label: 'Memory', pick: (r) => r.memory },
    { label: 'SQLite', pick: (r) => r.sqlite },
    { label: 'Postgres', pick: (r) => r.postgres },
    { label: 'File', pick: (r) => r.file },
  ];
</script>

{#if compact}
  {@const row = rows[0]}
  {@const hasPlanned = columns.some((c) => c.pick(row).status === 'planned')}
  <div class="persistence compact">
    <div class="summary">
      <span class="summary-label">Persistence</span>
      {#each columns as col (col.label)}
        {@const cell = col.pick(row)}
        <span class="backend {cell.status}">
          {#if cell.status === 'yes'}
            <Check class="cell-icon" size={15} aria-hidden="true" />
          {:else if cell.status === 'planned'}
            <Clock class="cell-icon" size={15} aria-hidden="true" />
          {:else}
            <X class="cell-icon" size={15} aria-hidden="true" />
          {/if}
          <span class="backend-name">{col.label}</span>{#if cell.isDefault}<span class="star" aria-hidden="true">*</span>{/if}
          <span class="sr-only"
            >— {labelFor[cell.status]}{#if cell.isDefault}, default{/if}</span
          >
        </span>
      {/each}
    </div>
    <p class="footnote">
      <span class="star" aria-hidden="true">*</span> default{#if hasPlanned}
        · clock = planned{/if} — see <a href="/docs/persistence/">Persistence</a> for all features.
    </p>
  </div>
{:else}
  <div class="persistence">
    <table>
      <thead>
        <tr>
          <th scope="col" class="feature-col">Feature</th>
          {#each columns as col (col.label)}
            <th scope="col">{col.label}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.key)}
          <tr>
            <th scope="row" class="feature-col">
              <a href={row.href}>{row.feature}</a>
            </th>
            {#each columns as col (col.label)}
              {@const cell = col.pick(row)}
              <td>
                <span class="col-label" aria-hidden="true">{col.label}</span>
                <span class="cell {cell.status}">
                  {#if cell.status === 'yes'}
                    <Check class="cell-icon" size={20} aria-hidden="true" />
                  {:else if cell.status === 'planned'}
                    <Clock class="cell-icon" size={20} aria-hidden="true" />
                  {:else}
                    <X class="cell-icon" size={20} aria-hidden="true" />
                  {/if}
                  <span class="sr-only">{labelFor[cell.status]}</span>
                  {#if cell.isDefault}<span class="star" aria-hidden="true">*</span><span class="sr-only">, default</span>{/if}
                </span>
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>

    <p class="legend">
      <span><span class="star" aria-hidden="true">*</span> default backend</span>
      <span><Clock class="legend-icon planned" size={15} aria-hidden="true" /> planned, not available yet</span>
    </p>

    <p class="footnote">
      Built-in backends only — most features also accept a store you write yourself. In-memory state is per process, so it gives no shared view across a multi-instance deploy.
    </p>
  </div>
{/if}

<style>
  .persistence {
    margin: 1.5rem 0;
  }

  .persistence.compact {
    margin: 0.75rem 0;
  }

  .summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem 0.8rem;
    padding: 0.25rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    font-size: 0.9rem;
  }

  .summary-label {
    font-weight: 600;
    color: var(--text-muted);
  }

  .compact .footnote {
    margin-top: 0.5rem;
  }

  .backend {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--text);
  }

  .backend :global(.cell-icon) {
    flex-shrink: 0;
    color: var(--badge-danger-text);
  }
  .backend.yes :global(.cell-icon) {
    color: var(--accent);
  }
  .backend.planned :global(.cell-icon) {
    color: var(--badge-tip-text);
  }

  .backend.no .backend-name {
    color: var(--text-muted);
  }

  .persistence :global(table) {
    margin: 0;
    font-size: 0.95rem;
  }

  /* Out-specify the docs page's underlined `.readme a` — an underline under
     every feature name makes the matrix look busy. */
  .persistence .feature-col a {
    color: var(--accent);
    text-decoration: none;
  }
  .persistence .feature-col a:hover {
    text-decoration: underline;
  }

  .cell {
    display: inline-flex;
    align-items: center;
    gap: 0.1rem;
  }

  .cell :global(.cell-icon) {
    flex-shrink: 0;
    color: var(--badge-danger-text);
  }
  .cell.yes :global(.cell-icon) {
    color: var(--accent);
  }
  .cell.planned :global(.cell-icon) {
    color: var(--badge-tip-text);
  }

  .star {
    color: var(--text-muted);
    font-weight: 600;
    line-height: 1;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    margin: 0.55rem 0 0;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .legend :global(.legend-icon.planned) {
    color: var(--badge-tip-text);
  }

  .footnote {
    margin: 0.35rem 0 0;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .col-label {
    display: none;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* Narrow screens: the column grid stops fitting, so each row becomes a
     stacked card with the column name repeated per cell. */
  @media (max-width: 700px) {
    .persistence :global(thead) {
      display: none;
    }
    .persistence :global(tr) {
      display: block;
      padding: 0.5rem 0;
    }
    .persistence :global(th),
    .persistence :global(td) {
      display: block;
      border: 0;
      padding: 0.15rem 0;
    }
    .col-label {
      display: inline-block;
      min-width: 7rem;
      color: var(--text-muted);
      font-size: 0.85rem;
    }
  }
</style>
