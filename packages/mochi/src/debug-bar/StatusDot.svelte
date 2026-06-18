<script lang="ts">
  import { onMount } from 'svelte';

  let status = $state<'idle' | 'connected' | 'disconnected'>('idle');

  let title = $derived(status === 'connected' ? 'Live reload connected' : status === 'disconnected' ? 'Live reload disconnected' : 'Live reload status');

  onMount(() => {
    if (window.__mochi_debug?.liveReloadEnabled === false) {
      status = 'connected';
      return;
    }

    // Snapshot the current socket, then follow window-level status events.
    // LiveReload swaps the socket on every reconnect, so binding to a single
    // instance here would miss later reconnects — the window event does not.
    const ws = window.__mochi_reload_ws;
    if (ws?.readyState === WebSocket.OPEN) {
      status = 'connected';
    } else if (ws && (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED)) {
      status = 'disconnected';
    }

    const onStatus = (e: Event) => {
      status = (e as CustomEvent<'connected' | 'disconnected'>).detail;
    };
    window.addEventListener('mochi:reload-status', onStatus);

    return () => {
      window.removeEventListener('mochi:reload-status', onStatus);
    };
  });
</script>

<span class="status-dot" class:connected={status === 'connected'} class:disconnected={status === 'disconnected'} {title}></span>

<style>
  .status-dot {
    position: relative;
    width: 0.55em;
    height: 0.55em;
    border-radius: 50%;
    background: #72786c;
    flex-shrink: 0;
    transition:
      background 120ms ease,
      box-shadow 120ms ease;
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
    background: #8ab79a;
    box-shadow: 0 0 6px rgba(138, 183, 154, 0.55);
  }
  .status-dot.connected::after {
    animation: mochi-reload-pulse 2s ease-out infinite;
  }
  .status-dot.disconnected {
    background: #e9a89a;
    box-shadow: 0 0 6px rgba(233, 168, 154, 0.5);
  }
  @keyframes mochi-reload-pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(138, 183, 154, 0.5);
      opacity: 1;
    }
    80% {
      box-shadow: 0 0 0 9px rgba(138, 183, 154, 0);
      opacity: 0;
    }
    100% {
      box-shadow: 0 0 0 0 rgba(138, 183, 154, 0);
      opacity: 0;
    }
  }
</style>
