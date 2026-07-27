<script lang="ts">
  import { onMount } from 'svelte';

  let status = $state<'idle' | 'connected' | 'reconnecting' | 'disconnected'>('idle');

  let title = $derived(
    status === 'connected'
      ? 'Live reload connected'
      : status === 'reconnecting'
        ? 'Live reload reconnecting…'
        : status === 'disconnected'
          ? 'Live reload disconnected'
          : 'Live reload status',
  );

  onMount(() => {
    if (window.__mochi_debug?.liveReloadEnabled === false) {
      status = 'connected';
      return;
    }
    // The live-reload client replaces its WebSocket on every reconnect, so the
    // dot tracks its broadcast status instead of a single socket instance.
    status = window.__mochi_live_reload_status ?? (window.__mochi_reload_ws?.readyState === WebSocket.OPEN ? 'connected' : 'disconnected');

    const onStatus = (e: Event) => {
      status = (e as CustomEvent<{ status: 'connected' | 'reconnecting' | 'disconnected' }>).detail.status;
    };
    addEventListener('mochi:live-reload-status', onStatus);
    return () => removeEventListener('mochi:live-reload-status', onStatus);
  });
</script>

<span class="status-dot" class:connected={status === 'connected'} class:reconnecting={status === 'reconnecting'} class:disconnected={status === 'disconnected'} {title}></span>

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
  .status-dot.reconnecting {
    background: #e0bb72;
    box-shadow: 0 0 6px rgba(224, 187, 114, 0.5);
    animation: mochi-reload-blink 1s ease-in-out infinite;
  }
  .status-dot.disconnected {
    background: #e9a89a;
    box-shadow: 0 0 6px rgba(233, 168, 154, 0.5);
  }
  @keyframes mochi-reload-blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
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
