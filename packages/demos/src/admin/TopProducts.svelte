<script lang="ts">
  type Product = { name: string; sku: string; sales: number; revenue: number };
  type Payload = { products: Product[]; generatedAt: string };

  let products = $state<Product[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let generatedAt = $state('');

  $effect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/products');
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as Payload;
        if (cancelled) {
          return;
        }
        products = data.products;
        generatedAt = new Date(data.generatedAt).toLocaleTimeString('en-GB');
      } catch (e: unknown) {
        if (!cancelled) {
          error = e instanceof Error ? e.message : String(e);
        }
      } finally {
        if (!cancelled) {
          loading = false;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  function formatCurrency(n: number): string {
    return '$' + n.toLocaleString('en-US');
  }
</script>

<div class="products">
  {#if loading}
    <ul class="skeleton-list" aria-hidden="true">
      {#each Array(5) as _, i (i)}
        <li class="skeleton-row">
          <span class="sk sk-name"></span>
          <span class="sk sk-num"></span>
          <span class="sk sk-num"></span>
        </li>
      {/each}
    </ul>
    <div class="meta dim">fetching /api/admin/products…</div>
  {:else if error}
    <div class="error">Failed to load products: {error}</div>
  {:else}
    <table class="table">
      <thead>
        <tr>
          <th>Product</th>
          <th class="num">Sales</th>
          <th class="num">Revenue</th>
        </tr>
      </thead>
      <tbody>
        {#each products as p (p.sku)}
          <tr>
            <td>
              <div class="name">{p.name}</div>
              <div class="sku">{p.sku}</div>
            </td>
            <td class="num">{p.sales.toLocaleString('en-US')}</td>
            <td class="num strong">{formatCurrency(p.revenue)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <div class="meta">fetched at {generatedAt}</div>
  {/if}
</div>

<style>
  .products {
    background: var(--admin-surface-muted);
    border: 1px solid var(--admin-border);
    border-radius: var(--admin-radius-md);
    padding: 0.5rem 0.85rem;
  }

  .table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.92rem;
  }

  .table th,
  .table td {
    padding: 0.55rem 0.4rem;
    text-align: left;
    border-bottom: 1px solid var(--admin-border);
  }

  .table tr:last-child td {
    border-bottom: none;
  }

  .table th {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--admin-text-subtle);
  }

  .num {
    text-align: right;
    font-family: var(--admin-font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--admin-text-muted);
    white-space: nowrap;
  }

  .strong {
    color: var(--admin-text);
    font-weight: 600;
  }

  .name {
    color: var(--admin-text);
    font-weight: 500;
  }

  .sku {
    font-family: var(--admin-font-mono);
    font-size: 0.74rem;
    color: var(--admin-text-subtle);
    margin-top: 0.1rem;
  }

  .meta {
    padding: 0.4rem 0 0.15rem;
    font-size: 0.72rem;
    color: var(--admin-text-subtle);
    font-family: var(--admin-font-mono);
    text-align: right;
  }

  .meta.dim {
    font-style: italic;
  }

  .skeleton-list {
    list-style: none;
    margin: 0;
    padding: 0.4rem 0;
  }

  .skeleton-row {
    display: grid;
    grid-template-columns: 1fr 60px 80px;
    gap: 0.75rem;
    align-items: center;
    padding: 0.55rem 0.4rem;
    border-bottom: 1px solid var(--admin-border);
  }

  .skeleton-row:last-child {
    border-bottom: none;
  }

  .sk {
    display: block;
    height: 0.85rem;
    border-radius: var(--admin-radius-sm);
    background: linear-gradient(90deg, var(--admin-border) 0%, var(--admin-border-strong) 50%, var(--admin-border) 100%);
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }

  .sk-name {
    width: 70%;
  }

  .sk-num {
    width: 100%;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  .error {
    padding: 0.85rem;
    color: var(--admin-badge-danger-text);
    background: var(--admin-badge-danger-bg);
    border-radius: var(--admin-radius-sm);
    font-size: 0.9rem;
  }
</style>
