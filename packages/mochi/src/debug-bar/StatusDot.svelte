<script lang="ts">
  import { onMount } from 'svelte';

  let status = $state<'idle' | 'connected' | 'disconnected'>('idle');

  let title = $derived(status === 'connected' ? 'Live reload connected' : status === 'disconnected' ? 'Live reload disconnected' : 'Live reload status');

  onMount(() => {
    const ws = window.__mochi_reload_ws;
    if (!ws) {
      status = 'disconnected';
      return;
    }
    if (ws.readyState === WebSocket.OPEN) {
      status = 'connected';
    } else if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
      status = 'disconnected';
    }

    const onOpen = () => {
      status = 'connected';
    };
    const onClose = () => {
      status = 'disconnected';
    };
    ws.addEventListener('open', onOpen);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onClose);

    return () => {
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('close', onClose);
      ws.removeEventListener('error', onClose);
    };
  });
</script>

<span class="status-dot" class:connected={status === 'connected'} class:disconnected={status === 'disconnected'} {title}></span>

<style>
  .status-dot {
    position: relative;
    width: 0.7em;
    height: 0.7em;
    border-radius: 50%;
    background: #64748b;
    flex-shrink: 0;
    transition:
      background 150ms ease,
      box-shadow 150ms ease;
  }
  .status-dot::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    pointer-events: none;
    opacity: 0;
  }
  .status-dot.connected {
    background: #22c55e;
    box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
  }
  .status-dot.connected::after {
    animation: mochi-reload-pulse 1.8s ease-out infinite;
  }
  .status-dot.disconnected {
    background: #ef4444;
    box-shadow: 0 0 6px rgba(239, 68, 68, 0.6);
  }
  @keyframes mochi-reload-pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.55);
      opacity: 1;
    }
    80% {
      box-shadow: 0 0 0 9px rgba(34, 197, 94, 0);
      opacity: 0;
    }
    100% {
      box-shadow: 0 0 0 0 rgba(34, 197, 94, 0);
      opacity: 0;
    }
  }
</style>
