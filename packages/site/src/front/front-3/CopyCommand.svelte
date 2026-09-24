<script lang="ts">
  import { onMount } from 'svelte';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import toast from 'svelte-french-toast';

  let { command = 'bun create mochi@latest' }: { command?: string } = $props();

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => () => {
    if (copyTimer) {
      clearTimeout(copyTimer);
    }
  });

  function copyCommand() {
    if (!navigator.clipboard) {
      toast.error('Clipboard unavailable in this browser');
      return;
    }
    navigator.clipboard
      .writeText(command)
      .then(() => {
        copied = true;
        toast.success('Copied to clipboard');
        if (copyTimer) {
          clearTimeout(copyTimer);
        }
        copyTimer = setTimeout(() => {
          copied = false;
        }, 1600);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'unknown';
        toast.error(`Copy failed: ${message}`);
      });
  }
</script>

<div class="command">
  <code class="command-text"><span class="prompt" aria-hidden="true">$</span>{command}</code>
  <button type="button" class="copy" onclick={copyCommand} aria-label={copied ? 'Copied to clipboard' : 'Copy command'}>
    {#if copied}
      <Check size={16} strokeWidth={2.4} />
      <span>Copied</span>
    {:else}
      <Copy size={16} strokeWidth={2} />
      <span>Copy</span>
    {/if}
  </button>
</div>

<style>
  .command {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    max-width: 100%;
    width: fit-content;
    padding: 0.5rem 0.5rem 0.5rem 1.1rem;
    background: var(--f3-card, #fffaf5);
    border: 2px solid var(--f3-line, rgba(59, 31, 36, 0.14));
    border-radius: 20px;
    box-shadow: 0 5px 0 var(--f3-card-shadow, #e39aab);
  }

  .command-text {
    display: flex;
    gap: 0.6rem;
    min-width: 0;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: 0.95rem;
    white-space: nowrap;
    color: var(--f3-ink, #3b1f24);
    scrollbar-width: none;
  }

  .prompt {
    color: var(--f3-matcha-deep, #5d7d3f);
    font-weight: 700;
    user-select: none;
  }

  .copy {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.55rem 0.85rem;
    font-family: var(--font-sans);
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--f3-on-matcha, #22300f);
    background: var(--f3-matcha, #a8c686);
    border: 0;
    border-radius: 13px;
    box-shadow: 0 3px 0 var(--f3-matcha-deep, #5d7d3f);
    cursor: pointer;
    transition:
      transform 0.1s ease,
      box-shadow 0.1s ease;
  }

  .copy:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 0 var(--f3-matcha-deep, #5d7d3f);
  }

  .copy:active {
    transform: translateY(3px) scale(1.03, 0.96);
    box-shadow: 0 0 0 var(--f3-matcha-deep, #5d7d3f);
  }

  .copy:focus-visible {
    outline: 3px solid var(--f3-ink, #3b1f24);
    outline-offset: 2px;
  }

  @media (max-width: 420px) {
    .command {
      gap: 0.5rem;
      padding-left: 0.85rem;
    }

    .command-text {
      gap: 0.45rem;
      font-size: 0.84rem;
    }
  }
</style>
