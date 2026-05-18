<script lang="ts">
  let { islandId } = $props();

  let wsTime = $state('--:--:--');
  let sseTime = $state('--:--:--');
  let wsStatus = $state('connecting');
  let sseStatus = $state('connecting');

  $effect(() => {
    const host = window.location.host;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    const timeWs = new WebSocket(`${wsProtocol}//${host}/ws/time`);
    timeWs.addEventListener('open', () => {
      wsStatus = 'connected';
    });
    timeWs.addEventListener('message', (e) => {
      wsTime = new Date(e.data).toLocaleTimeString('en-GB');
    });
    timeWs.addEventListener('close', () => {
      wsStatus = 'disconnected';
    });

    const timeSse = new EventSource(`/sse/time/`);
    timeSse.addEventListener('open', () => {
      sseStatus = 'connected';
    });
    timeSse.addEventListener('message', (e) => {
      sseTime = new Date(e.data).toLocaleTimeString('en-GB');
    });
    timeSse.addEventListener('error', () => {
      sseStatus = 'disconnected';
    });

    const closeAll = () => {
      timeWs.close();
      timeSse.close();
    };
    window.addEventListener('pagehide', closeAll);

    return () => {
      window.removeEventListener('pagehide', closeAll);
      closeAll();
    };
  });
</script>

<div class="clocks">
  <div class="clock">
    <div class="clock-header">
      <span class="protocol">WebSocket</span>
      <span class="status" class:connected={wsStatus === 'connected'}>{wsStatus}</span>
    </div>
    <span class="time">{wsTime}</span>
    <span class="endpoint">/ws/time</span>
  </div>
  <div class="clock">
    <div class="clock-header">
      <span class="protocol">SSE</span>
      <span class="status" class:connected={sseStatus === 'connected'}>{sseStatus}</span>
    </div>
    <span class="time">{sseTime}</span>
    <span class="endpoint">/sse/time</span>
  </div>
  {#if islandId}
    <div class="island-id">island-id: {islandId}</div>
  {/if}
</div>

<style>
  .clocks {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }

  @media (max-width: 480px) {
    .clocks {
      grid-template-columns: 1fr;
    }
  }

  .clock {
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 1rem 1.1rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
  }

  .clock-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    justify-content: space-between;
  }

  .protocol {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .status {
    font-size: 0.7rem;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    background: var(--badge-danger-bg);
    color: var(--badge-danger-text);
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .status.connected {
    background: var(--badge-success-bg);
    color: var(--badge-success-text);
  }

  .time {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--text);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
  }

  .endpoint {
    font-size: 0.8rem;
    color: var(--text-subtle);
    font-family: var(--font-mono);
  }

  .island-id {
    grid-column: 1 / -1;
    text-align: center;
    font-size: 0.75rem;
    color: var(--text-subtle);
    font-family: var(--font-mono);
  }
</style>
