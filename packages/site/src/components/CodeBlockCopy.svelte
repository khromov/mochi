<!-- Mounted once per page: a single delegated click listener replaces a per-block copy handler. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { isBrowser } from 'mochi-framework';
  import toast, { Toaster } from 'svelte-french-toast';
  import type { MochiDirectives } from 'mochi-framework';

  let {}: MochiDirectives = $props();

  onMount(() => {
    async function handleClick(e: MouseEvent) {
      const btn = (e.target as Element | null)?.closest('.code-copy');
      if (!btn) {
        return;
      }
      const pre = btn.closest('.code-block')?.querySelector('pre');
      if (!pre) {
        return;
      }
      try {
        await navigator.clipboard.writeText(pre.textContent ?? '');
        toast.success('Copied to clipboard');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown';
        toast.error(`Copy failed: ${message}`);
      }
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  });
</script>

{#if isBrowser}
  <Toaster position="top-center" />
{/if}
