<script>
  import AdminLayout from './AdminLayout.svelte';
  import StatsGrid from './StatsGrid.svelte';
  import LiveStockTicker from './LiveStockTicker.svelte';
  import RecentActivity from './RecentActivity.svelte';
  import TopProducts from './TopProducts.svelte';

  const renderedAt = new Date().toLocaleTimeString('en-GB');
</script>

<AdminLayout activeNav="dashboard" metaTags={{ title: 'Dashboard | Mochi Admin' }}>
  <div class="dash">
    <header class="dash-head">
      <div>
        <h1 class="title">Dashboard</h1>
        <p class="sub">Overview · rendered at {renderedAt}</p>
      </div>
      <span class="env">production</span>
    </header>

    <section class="section">
      <div class="section-head">
        <h2>Key metrics</h2>
        <span class="tag ssr">SSR only</span>
      </div>
      <StatsGrid />
    </section>

    <section class="section">
      <div class="section-head">
        <h2>Live ticker</h2>
        <span class="tag hydrate">Hydrated (mochi:hydrate)</span>
      </div>
      <LiveStockTicker mochi:hydrate />
    </section>

    <section class="section">
      <div class="section-head">
        <h2>Recent activity</h2>
        <span class="tag defer">Server Island (mochi:defer)</span>
      </div>
      <RecentActivity mochi:defer>
        <div class="island-loading">
          Loading recent activity<span class="dots"></span>
        </div>
      </RecentActivity>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>Top products</h2>
        <span class="tag hydrate">Hydrated (mochi:hydrate)</span>
      </div>
      <TopProducts mochi:hydrate={{ rootMargin: '120px' }} />
    </section>
  </div>
</AdminLayout>

<style>
  .dash {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .dash-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 0.85rem;
    border-bottom: 1px solid var(--admin-border);
  }

  .title {
    font-family: var(--admin-font-serif);
    font-size: 1.6rem;
    font-weight: 500;
    color: var(--admin-text);
    margin: 0;
    letter-spacing: -0.01em;
  }

  .sub {
    margin: 0.2rem 0 0;
    font-size: 0.82rem;
    color: var(--admin-text-subtle);
    font-family: var(--admin-font-mono);
    font-variant-numeric: tabular-nums;
  }

  .env {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.25rem 0.65rem;
    border-radius: 999px;
    background: var(--admin-badge-success-bg);
    color: var(--admin-badge-success-text);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .section-head h2 {
    margin: 0;
    font-family: var(--admin-font-serif);
    font-size: 1.05rem;
    font-weight: 500;
    color: var(--admin-text);
  }

  .tag {
    font-family: var(--admin-font-mono);
    font-size: 0.7rem;
    font-weight: 600;
    padding: 0.18rem 0.5rem;
    border-radius: var(--admin-radius-sm);
    background: var(--admin-badge-default-bg);
    color: var(--admin-badge-default-text);
    letter-spacing: 0.02em;
  }

  .tag.hydrate {
    background: var(--admin-badge-success-bg);
    color: var(--admin-badge-success-text);
  }

  .tag.defer {
    background: var(--admin-badge-info-bg);
    color: var(--admin-badge-info-text);
  }

  .island-loading {
    padding: 1rem;
    border: 2px dashed var(--admin-border-strong);
    border-radius: var(--admin-radius-md);
    background: var(--admin-surface-muted);
    color: var(--admin-text-subtle);
    font-style: italic;
    text-align: center;
  }

  .dots::after {
    content: '';
    display: inline-block;
    width: 1.5em;
    text-align: left;
    animation: dots 1.2s steps(4, end) infinite;
  }

  @keyframes dots {
    0% {
      content: '';
    }
    25% {
      content: '.';
    }
    50% {
      content: '..';
    }
    75% {
      content: '...';
    }
  }

  @media (max-width: 768px) {
    .dash-head {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
    }

    .section-head {
      flex-wrap: wrap;
    }

    .title {
      font-size: 1.35rem;
    }
  }
</style>
