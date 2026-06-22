<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';
  import Clock from '@lucide/svelte/icons/clock';

  type Status = 'yes' | 'no' | 'partial' | 'planned';
  interface Cell {
    status: Status;
    note?: string;
    href?: string;
  }
  interface Row {
    feature: string;
    mochi: Cell;
    kit: Cell;
  }

  const rows: Row[] = [
    {
      feature: 'Server islands / selective hydration',
      mochi: { status: 'yes', note: 'mochi:defer', href: '/docs/server-islands/' },
      kit: { status: 'no', note: 'full page hydration only' },
    },
    {
      feature: 'Built-in SQLite database',
      mochi: { status: 'yes', note: 'bun:sqlite', href: 'https://bun.com/docs/api/sqlite' },
      kit: { status: 'partial', note: 'Only with adapter-node' },
    },
    {
      feature: 'Built-in Postgres & MySQL support',
      mochi: { status: 'yes', note: 'Bun.sql()', href: 'https://bun.com/docs/api/sql' },
      kit: { status: 'no', note: 'bring your own cloud database' },
    },
    { feature: 'Background job queues', mochi: { status: 'yes', note: 'Mochi.queue()', href: '/docs/queues/' }, kit: { status: 'no' } },
    {
      feature: 'JavaScript bundle size optimization',
      mochi: { status: 'yes', note: 'optimized for first page load' },
      kit: { status: 'partial', note: 'optimized for several page views; slightly larger on first load' },
    },
    {
      feature: 'Deployment targets',
      mochi: { status: 'no', note: 'Bun only' },
      kit: { status: 'yes', note: 'Node, Vercel, Bun and other cloud providers' },
    },
    { feature: 'Client-side router (goto / invalidate)', mochi: { status: 'no' }, kit: { status: 'yes' } },
    { feature: 'Prerendering / SSG', mochi: { status: 'no' }, kit: { status: 'yes' } },
    { feature: 'Form actions + progressively enhanced forms', mochi: { status: 'yes' }, kit: { status: 'yes' } },
    { feature: 'Middleware', mochi: { status: 'yes' }, kit: { status: 'yes' } },
    { feature: 'Hooks & extension filters', mochi: { status: 'yes', note: 'eventHooks & filters', href: '/docs/extensions/' }, kit: { status: 'no' } },
    { feature: 'Top-level await', mochi: { status: 'yes' }, kit: { status: 'partial', note: 'experimental' } },
    {
      feature: 'Real-time WebSockets',
      mochi: { status: 'yes', note: 'Mochi.ws()', href: '/docs/websocket-routes/' },
      kit: { status: 'no', note: 'custom server with external package' },
    },
    { feature: 'Server-Sent Events', mochi: { status: 'yes', note: 'Mochi.sse()', href: '/docs/server-sent-events/' }, kit: { status: 'no', note: 'manual setup' } },
    { feature: 'Built-in caching library', mochi: { status: 'yes', note: 'MochiCache', href: '/docs/cache/' }, kit: { status: 'no' } },
    { feature: 'Cookie helpers', mochi: { status: 'yes' }, kit: { status: 'yes' } },
    { feature: 'Remote functions (type-safe RPC)', mochi: { status: 'no' }, kit: { status: 'yes', note: 'experimental' } },
    {
      feature: 'View Transitions',
      mochi: { status: 'yes', note: 'built-in component', href: '/docs/view-transitions/' },
      kit: { status: 'partial', note: 'manual wiring', href: 'https://svelte.dev/blog/view-transitions' },
    },
    {
      feature: 'Centralized logging system',
      mochi: { status: 'yes', note: 'mochiEvents', href: '/docs/events/' },
      kit: { status: 'no', note: 'experimental OpenTelemetry only' },
    },
    {
      feature: 'Image resizing',
      mochi: { status: 'planned', note: 'build & runtime transformations' },
      kit: { status: 'partial', note: 'build-time only; runtime at extra cost' },
    },
    { feature: 'Link preloading', mochi: { status: 'planned' }, kit: { status: 'yes' } },
    { feature: 'Service worker integration', mochi: { status: 'planned' }, kit: { status: 'yes' } },
    { feature: 'Snapshots', mochi: { status: 'partial', note: 'browser-native restoration' }, kit: { status: 'yes', note: 'manual setup' } },
  ];

  const labelFor: Record<Status, string> = { yes: 'Yes', no: 'No', partial: 'Partial', planned: 'Planned' };
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
