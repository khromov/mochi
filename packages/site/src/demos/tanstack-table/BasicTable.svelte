<script lang="ts">
  import { createTable, FlexRender, tableFeatures } from '@tanstack/svelte-table';
  import type { ColumnDef } from '@tanstack/svelte-table';
  import { people, type Person } from './data.ts';

  const features = tableFeatures({});

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
                <FlexRender {header} />
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
    padding: 0.55rem 0.85rem;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }

  th {
    font-weight: 600;
    color: var(--text-muted);
    background: var(--surface-muted);
  }

  tbody tr:last-child td {
    border-bottom: none;
  }
</style>
