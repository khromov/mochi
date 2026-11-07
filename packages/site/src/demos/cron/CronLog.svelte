<script lang="ts">
  import type { CronLogEntry, CronLogMessage } from './types';

  let status = $state('connecting');
  let entries = $state<CronLogEntry[]>([]);

  const skeletons = $derived([...Array(Math.max(0, 5 - entries.length)).keys()]);

  $effect(() => {
    const host = window.location.host;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${host}/ws/cron-log`);

    ws.addEventListener('open', () => (status = 'connected'));
    ws.addEventListener('close', () => (status = 'disconnected'));
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data) as CronLogMessage;
      if (msg.type === 'snapshot') {
        entries = msg.entries;
      } else {
        entries = [msg.entry, ...entries].slice(0, 100);
      }
    });

    const close = () => ws.close();
    window.addEventListener('pagehide', close);

    return () => {
      window.removeEventListener('pagehide', close);
      close();
    };
  });

  const fmtTime = (ms: number): string => new Date(ms).toLocaleTimeString('en-GB');
</script>

<div class="cron">
  <div class="bar">
    <span class="status" class:connected={status === 'connected'}>{status}</span>
  </div>

  <ul class="log">
    {#each entries as entry (entry.seq)}
      <li class="row">
        <span class="seq">#{entry.seq}</span>
        <span class="time">{fmtTime(entry.at)}</span>
        <span class="label">demo-activity-log ran</span>
      </li>
    {/each}
    {#each skeletons as i (i)}
      <li class="row skeleton" aria-hidden="true">
        <span class="sk sk-seq"></span>
        <span class="sk sk-time"></span>
        <span class="sk sk-label"></span>
      </li>
    {/each}
  </ul>
</div>

<style>
  .cron {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .status {
    font-size: 0.7rem;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    background: var(--badge-danger-bg);
    color: var(--badge-danger-text);
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .status.connected {
    background: var(--badge-success-bg);
    color: var(--badge-success-text);
  }

  .log {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow-y: auto;
    max-height: 13.75rem;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    height: 2.75rem;
    box-sizing: border-box;
    padding: 0 0.9rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface-muted);
  }

  .row:last-child {
    border-bottom: none;
  }

  .sk {
    height: 0.7rem;
    border-radius: 4px;
    background: var(--border);
    animation: skeleton-pulse 1.5s ease-in-out infinite;
  }

  .sk-seq {
    width: 2rem;
  }

  .sk-time {
    width: 4rem;
  }

  .sk-label {
    width: 45%;
  }

  @keyframes skeleton-pulse {
    0%,
    100% {
      opacity: 0.35;
    }
    50% {
      opacity: 0.7;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sk {
      animation: none;
    }
  }

  .seq {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    color: var(--text-subtle);
    min-width: 3rem;
  }

  .time {
    font-family: var(--font-mono);
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .label {
    font-size: 0.85rem;
    color: var(--text-muted);
  }
</style>
