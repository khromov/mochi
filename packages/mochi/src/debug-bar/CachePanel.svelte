<script lang="ts">
  import { onDestroy } from 'svelte';
  import DebugPanel from './DebugPanel.svelte';
  import Trash from '../icons/trash-2.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  type Status = 'idle' | 'clearing' | 'done' | 'error';
  let status: Status = $state('idle');
  let errorMsg = $state('');
  let count: number | null = $state(null);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  const LABELS: Record<Status, string> = {
    idle: 'Empty image cache',
    clearing: 'Clearing…',
    done: 'Cleared ✓',
    error: 'Failed — retry',
  };

  const endpoint = () => `${window.__mochi_asset_prefix ?? ''}/image-cache/`;

  async function refreshCount() {
    try {
      const res = await fetch(endpoint());
      if (res.ok) {
        const data = (await res.json()) as { count?: number };
        count = typeof data.count === 'number' ? data.count : null;
      }
    } catch {
      /* leave the last known count */
    }
  }

  // Refresh the count each time the panel is opened so the badge reflects reality.
  $effect(() => {
    if (open) {
      void refreshCount();
    }
  });

  async function clearCache() {
    if (status === 'clearing') {
      return;
    }
    status = 'clearing';
    errorMsg = '';
    clearTimeout(resetTimer);
    try {
      const res = await fetch(endpoint(), { method: 'POST' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { count?: number };
      count = typeof data.count === 'number' ? data.count : 0;
      status = 'done';
      resetTimer = setTimeout(() => (status = 'idle'), 2000);
    } catch (err) {
      status = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
      resetTimer = setTimeout(() => (status = 'idle'), 4000);
    }
  }

  onDestroy(() => clearTimeout(resetTimer));
</script>

<DebugPanel title="Cache" color="#a7d0c4" {open} {onclose}>
  <div class="cache-body">
    <p class="cache-desc">Empties the on-disk image cache — every original, resized variant, and blur placeholder.</p>
    <button class="cache-clear-btn" class:is-done={status === 'done'} class:is-error={status === 'error'} type="button" onclick={clearCache} disabled={status === 'clearing'}>
      <Trash size={13} />
      <span class="cache-clear-label">{LABELS[status]}</span>
      {#if count !== null}
        <span class="cache-count-badge">{count}</span>
      {/if}
    </button>
    {#if status === 'error' && errorMsg}
      <div class="cache-error">{errorMsg}</div>
    {/if}
  </div>
</DebugPanel>

<style>
  .cache-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .cache-desc {
    margin: 0;
    color: #9aa094;
    font-size: 11px;
    line-height: 1.5;
    padding: 0 2px;
  }
  .cache-clear-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: #223833;
    color: #a7d0c4;
    border: 1px solid #3f5f54;
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    letter-spacing: 0.03em;
    cursor: pointer;
    transition:
      background 120ms ease,
      color 120ms ease,
      border-color 120ms ease;
  }
  .cache-clear-label {
    flex: 0 1 auto;
  }
  .cache-count-badge {
    border-radius: 999px;
    min-width: 1.5em;
    height: 1.5em;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.82em;
    font-weight: 600;
    padding: 0 0.5em;
    background: rgba(111, 174, 156, 0.28);
    color: #d4f0e6;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    letter-spacing: 0;
  }
  .cache-clear-btn:hover:not(:disabled) {
    background: #2b453e;
    color: #c8ece0;
    border-color: #6fae9c;
  }
  .cache-clear-btn:disabled {
    cursor: default;
    opacity: 0.7;
  }
  .cache-clear-btn.is-done {
    background: #234034;
    color: #b6e8c8;
    border-color: #4f8a63;
  }
  .cache-clear-btn.is-error {
    background: #402823;
    color: #f4b6a7;
    border-color: #7a3a2a;
  }
  .cache-error {
    color: #f4b6a7;
    font-size: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    padding: 0 2px;
    word-break: break-all;
  }
</style>
