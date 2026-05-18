<script lang="ts">
  type Stat = {
    label: string;
    value: string;
    delta: string;
    direction: 'up' | 'down';
  };

  const stats: Stat[] = [
    { label: 'Total users', value: '12,438', delta: '+4.2%', direction: 'up' },
    { label: 'Revenue', value: '$84,210', delta: '+1.8%', direction: 'up' },
    { label: 'Orders', value: '2,109', delta: '+0.6%', direction: 'up' },
    { label: 'Refunds', value: '37', delta: '-12%', direction: 'down' },
  ];
</script>

<div class="stats-grid">
  {#each stats as stat (stat.label)}
    <div class="stat">
      <div class="stat-label">{stat.label}</div>
      <div class="stat-value">{stat.value}</div>
      <div class="stat-delta" class:down={stat.direction === 'down'}>
        <span class="arrow">{stat.direction === 'up' ? '▲' : '▼'}</span>
        {stat.delta}
      </div>
    </div>
  {/each}
</div>

<style>
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.6rem;
  }

  @media (max-width: 768px) {
    .stats-grid {
      grid-template-columns: 1fr;
      gap: 0.6rem;
    }
  }

  .stat {
    background: var(--admin-surface-muted);
    border: 1px solid var(--admin-border);
    border-radius: var(--admin-radius-md);
    padding: 0.85rem 0.95rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
  }

  .stat-label {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--admin-text-subtle);
  }

  .stat-value {
    font-family: var(--admin-font-serif);
    font-size: 1.5rem;
    font-weight: 500;
    letter-spacing: -0.01em;
    color: var(--admin-text);
    font-variant-numeric: tabular-nums;
  }

  .stat-delta {
    font-size: 0.78rem;
    font-family: var(--admin-font-mono);
    color: var(--admin-badge-success-text);
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .stat-delta.down {
    color: var(--admin-badge-danger-text);
  }

  .arrow {
    font-size: 0.7em;
  }
</style>
