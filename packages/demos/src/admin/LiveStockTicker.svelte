<script lang="ts">
  type Tick = { price: number; change: number; timestamp: string };

  let price = $state<number | null>(null);
  let lastChange = $state(0);
  let status = $state<'connecting' | 'live' | 'offline'>('connecting');
  // EventSource fires `error` on every transient disconnect before auto-reconnecting,
  // so only flip to 'offline' once the connection is fully closed.
  let history = $state<number[]>([]);
  let updatedAt = $state('—');

  $effect(() => {
    const source = new EventSource('/sse/admin/stock');

    source.addEventListener('open', () => {
      status = 'live';
    });

    source.addEventListener('message', (event) => {
      const tick = JSON.parse(event.data) as Tick;
      price = tick.price;
      lastChange = tick.change;
      updatedAt = new Date(tick.timestamp).toLocaleTimeString('en-GB');
      history = [...history, tick.price].slice(-32);
    });

    source.addEventListener('error', () => {
      status = source.readyState === EventSource.CLOSED ? 'offline' : 'connecting';
    });

    return () => source.close();
  });

  function sparkPath(values: number[], width: number, height: number): string {
    if (values.length < 2) {
      return '';
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const stepX = width / (values.length - 1);
    return values
      .map((v, i) => {
        const x = i * stepX;
        const y = height - ((v - min) / range) * height;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  const sparkW = 240;
  const sparkH = 56;
</script>

<div class="ticker">
  <div class="ticker-head">
    <div class="symbol">
      <span class="dot" class:live={status === 'live'} class:off={status === 'offline'}></span>
      <span class="ticker-name">MOCHI</span>
      <span class="ticker-sub">Mochi Inc.</span>
    </div>
    <span class="status">{status}</span>
  </div>

  <div class="ticker-body">
    <div class="price-block">
      <div class="price">
        {#if price === null}
          <span class="dim">—</span>
        {:else}
          ${price.toFixed(2)}
        {/if}
      </div>
      <div class="change" class:up={lastChange >= 0} class:down={lastChange < 0}>
        {lastChange >= 0 ? '▲' : '▼'}
        {lastChange >= 0 ? '+' : ''}{lastChange.toFixed(2)}
      </div>
    </div>

    <svg class="spark" viewBox="0 0 {sparkW} {sparkH}" preserveAspectRatio="none" aria-hidden="true">
      {#if history.length > 1}
        <path d={sparkPath(history, sparkW, sparkH)} class:up={lastChange >= 0} class:down={lastChange < 0} />
      {/if}
    </svg>
  </div>

  <div class="ticker-foot">
    <span>updated {updatedAt}</span>
    <span class="endpoint">/sse/admin/stock</span>
  </div>
</div>

<style>
  .ticker {
    background: var(--admin-surface-muted);
    border: 1px solid var(--admin-border);
    border-radius: var(--admin-radius-md);
    padding: 0.95rem 1.05rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  .ticker-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .symbol {
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
    min-width: 0;
  }

  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--admin-text-subtle);
    align-self: center;
    flex-shrink: 0;
  }

  .dot.live {
    background: var(--admin-badge-success-text);
    box-shadow: 0 0 0 0 rgba(74, 124, 89, 0.4);
    animation: pulse 1.6s ease-out infinite;
  }

  .dot.off {
    background: var(--admin-badge-danger-text);
  }

  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(74, 124, 89, 0.45);
    }
    100% {
      box-shadow: 0 0 0 10px rgba(74, 124, 89, 0);
    }
  }

  .ticker-name {
    font-family: var(--admin-font-mono);
    font-weight: 700;
    letter-spacing: 0.05em;
    color: var(--admin-text);
  }

  .ticker-sub {
    font-size: 0.78rem;
    color: var(--admin-text-subtle);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--admin-text-subtle);
  }

  .ticker-body {
    display: grid;
    grid-template-columns: minmax(0, auto) 1fr;
    align-items: center;
    gap: 1rem;
  }

  @media (max-width: 480px) {
    .ticker-body {
      grid-template-columns: 1fr;
    }
  }

  .price-block {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .price {
    font-family: var(--admin-font-serif);
    font-size: 2rem;
    font-weight: 500;
    letter-spacing: -0.01em;
    color: var(--admin-text);
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .price .dim {
    color: var(--admin-text-subtle);
  }

  .change {
    font-family: var(--admin-font-mono);
    font-size: 0.85rem;
    font-weight: 600;
  }

  .change.up {
    color: var(--admin-badge-success-text);
  }

  .change.down {
    color: var(--admin-badge-danger-text);
  }

  .spark {
    width: 100%;
    height: 56px;
    overflow: visible;
  }

  .spark path {
    fill: none;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke: var(--admin-text-muted);
    transition: stroke 0.2s ease;
  }

  .spark path.up {
    stroke: var(--admin-badge-success-text);
  }

  .spark path.down {
    stroke: var(--admin-badge-danger-text);
  }

  .ticker-foot {
    display: flex;
    justify-content: space-between;
    font-size: 0.72rem;
    color: var(--admin-text-subtle);
    font-family: var(--admin-font-mono);
    font-variant-numeric: tabular-nums;
  }

  .endpoint {
    color: var(--admin-text-subtle);
  }
</style>
