<script lang="ts">
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import toast from 'svelte-french-toast';
  import { onDestroy } from 'svelte';

  let { command }: { command: string } = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  onDestroy(() => clearTimeout(timer));

  async function copy() {
    if (!navigator.clipboard) {
      toast.error('Clipboard unavailable in this browser');
      return;
    }
    try {
      await navigator.clipboard.writeText(command);
      copied = true;
      toast.success('Copied to clipboard');
      clearTimeout(timer);
      timer = setTimeout(() => (copied = false), 1600);
    } catch (err) {
      toast.error(`Copy failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }
</script>

<button class="command" class:copied type="button" onclick={copy} aria-label={copied ? 'Copied to clipboard' : `Copy command: ${command}`} title="Click to copy">
  <span class="prompt" aria-hidden="true">$</span>
  <span class="cmd">{command}</span>
  <span class="icon" aria-hidden="true">
    {#if copied}
      <Check size={15} strokeWidth={2.2} />
    {:else}
      <Copy size={15} strokeWidth={1.8} />
    {/if}
  </span>
</button>

<style>
  .command {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    max-width: 100%;
    padding: 0.8rem 0.9rem 0.8rem 1rem;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--text, #e8e6dd);
    background: rgba(232, 230, 221, 0.04);
    border: 1px solid var(--border-strong, #34402f);
    border-radius: 6px;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background 0.15s ease;
  }

  .command:hover {
    border-color: var(--accent, #a7c9a8);
    background: rgba(167, 201, 168, 0.07);
  }

  .command:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .prompt {
    color: var(--accent, #a7c9a8);
  }

  .cmd {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .icon {
    display: inline-flex;
    padding-left: 0.75rem;
    margin-left: 0.25rem;
    color: var(--text-subtle, #7d8577);
    border-left: 1px solid var(--border, #222a21);
    transition: color 0.15s ease;
  }

  .command:hover .icon,
  .copied .icon {
    color: var(--accent, #a7c9a8);
  }
</style>
