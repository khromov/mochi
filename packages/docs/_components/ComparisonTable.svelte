<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';

  interface Cell {
    yes: boolean;
    note?: string;
    href?: string;
  }
  interface Row {
    feature: string;
    mochi: Cell;
    kit: Cell;
  }

  const rows: Row[] = [
    { feature: 'Background job queues', mochi: { yes: true, note: 'Mochi.queue()', href: '/docs/queues/' }, kit: { yes: false } },
    { feature: 'Built-in SQLite database', mochi: { yes: true, note: 'bun:sqlite', href: '/docs/server-only-imports/' }, kit: { yes: false, note: 'bring your own' } },
    {
      feature: 'Real-time WebSockets',
      mochi: { yes: true, note: 'Mochi.ws()', href: '/docs/websocket-routes/' },
      kit: { yes: false, note: 'custom server with external package' },
    },
    { feature: 'Server-Sent Events', mochi: { yes: true, note: 'Mochi.sse()', href: '/docs/server-sent-events/' }, kit: { yes: false, note: 'manual stream' } },
    { feature: 'Server islands / selective hydration', mochi: { yes: true, note: 'mochi:defer', href: '/docs/server-islands/' }, kit: { yes: false, note: 'full hydration' } },
    { feature: 'SWR caching', mochi: { yes: true, note: 'MochiCache', href: '/docs/cache/' }, kit: { yes: false } },
    { feature: 'View Transitions', mochi: { yes: true, note: 'built-in component', href: '/docs/view-transitions/' }, kit: { yes: false, note: 'manual wiring' } },
    { feature: 'Image resizing', mochi: { yes: true, note: 'Bun.Image(), coming soon', href: '/docs/why-bun/' }, kit: { yes: false, note: 'enhanced-img plugin' } },
    { feature: 'Observability event bus', mochi: { yes: true, note: 'mochiEvents', href: '/docs/events/' }, kit: { yes: false, note: 'experimental OpenTelemetry' } },
    { feature: 'Form actions + enhance', mochi: { yes: true }, kit: { yes: true } },
    { feature: 'Middleware / hooks', mochi: { yes: true }, kit: { yes: true } },
    { feature: 'Cookies & CSRF protection', mochi: { yes: true }, kit: { yes: true } },
    { feature: 'Client-side router (goto / invalidate)', mochi: { yes: false }, kit: { yes: true } },
    { feature: 'Nested layouts', mochi: { yes: false, note: 'manual wrappers' }, kit: { yes: true } },
    { feature: 'Prerendering / SSG', mochi: { yes: false }, kit: { yes: true } },
    { feature: 'Remote functions (type-safe RPC)', mochi: { yes: false }, kit: { yes: true, note: 'experimental' } },
    { feature: 'Deployment adapters', mochi: { yes: false, note: 'Bun only' }, kit: { yes: true } },
    { feature: 'Link preloading / shallow routing', mochi: { yes: false }, kit: { yes: true } },
    { feature: 'Service worker integration', mochi: { yes: false }, kit: { yes: true } },
    { feature: 'Snapshots', mochi: { yes: false, note: 'bfcache' }, kit: { yes: true } },
  ];
</script>

<div class="comparison">
  <table class="comparison-table">
    <thead>
      <tr>
        <th scope="col" class="feature-col">Feature</th>
        <th scope="col">Mochi</th>
        <th scope="col">SvelteKit</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.feature)}
        <tr>
          <th scope="row" class="feature-col">{row.feature}</th>
          {#each [row.mochi, row.kit] as cell, i (i)}
            {@const Icon = cell.yes ? Check : X}
            <td>
              <span class="cell {cell.yes ? 'yes' : 'no'}">
                <Icon class="cell-icon" size={22} aria-hidden="true" />
                <span class="label"
                  >{cell.yes ? 'Yes' : 'No'}{#if cell.note}<span class="note"
                      >&nbsp;-&nbsp;{#if cell.href}<a href={cell.href}>{cell.note}</a>{:else}{cell.note}{/if}</span
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
  .comparison {
    margin: 1.5rem 0 1.25rem;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .comparison-table {
    width: 100%;
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
    vertical-align: middle;
  }

  .comparison-table thead th {
    background: var(--surface-muted);
    font-weight: 600;
    white-space: nowrap;
  }

  .feature-col {
    font-weight: 500;
    color: var(--text);
  }

  tbody .feature-col {
    width: 42%;
  }

  .comparison-table tbody tr:last-child th,
  .comparison-table tbody tr:last-child td {
    border-bottom: none;
  }

  .cell {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .cell :global(.cell-icon) {
    flex-shrink: 0;
  }

  .label {
    font-weight: 500;
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
</style>
