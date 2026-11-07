<script lang="ts">
  import { createSortedRowModel, createTable, FlexRender, rowSortingFeature, sortFns, tableFeatures } from '@tanstack/svelte-table';
  import type { ColumnDef } from '@tanstack/svelte-table';
  import { people, type Person } from './data.ts';

  const features = tableFeatures({
    rowSortingFeature,
    sortedRowModel: createSortedRowModel(),
    sortFns,
  });

  const columns: ColumnDef<typeof features, Person>[] = [
    { accessorKey: 'firstName', header: 'First name', cell: (info) => info.getValue() },
    { accessorKey: 'lastName', header: 'Last name', cell: (info) => info.getValue() },
    { accessorKey: 'age', header: 'Age', cell: (info) => info.getValue() },
  ];

  const table = createTable({
    features,
    columns,
    get data() {
      return people;
    },
  });
</script>

<div class="table-wrap">
  <table>
    <thead>
      {#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
        <tr>
          {#each headerGroup.headers as header (header.id)}
            <th>
              {#if !header.isPlaceholder}
                <button
                  type="button"
                  class="sort"
                  class:active={header.column.getIsSorted() !== false}
                  disabled={!header.column.getCanSort()}
                  onclick={header.column.getToggleSortingHandler()}
                >
                  <FlexRender {header} />
                  <span class="arrow" aria-hidden="true">
                    {#if header.column.getIsSorted() === 'asc'}
                      ▲
                    {:else if header.column.getIsSorted() === 'desc'}
                      ▼
                    {/if}
                  </span>
                </button>
              {/if}
            </th>
          {/each}
        </tr>
      {/each}
    </thead>
    <tbody>
      {#each table.getRowModel().rows as row (row.id)}
        <tr>
          {#each row.getAllCells() as cell (cell.id)}
            <td><FlexRender {cell} /></td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 8px);
    background: var(--surface);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
    color: var(--text);
  }

  th,
  td {
    text-align: left;
    padding: 0.2rem 0.35rem;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }

  td {
    padding: 0.55rem 0.85rem;
  }

  th {
    background: var(--surface-muted);
  }

  .sort {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    width: 100%;
    padding: 0.35rem 0.5rem;
    background: none;
    border: none;
    border-radius: 5px;
    font: inherit;
    font-weight: 600;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.12s ease;
  }

  .sort:not(:disabled):hover {
    color: var(--text);
  }

  .sort.active {
    color: var(--accent);
  }

  .sort:disabled {
    cursor: default;
  }

  .arrow {
    font-size: 0.7em;
    min-width: 0.8em;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }
</style>
