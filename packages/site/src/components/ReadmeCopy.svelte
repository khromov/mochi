<script lang="ts">
  import toast from 'svelte-french-toast';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Copy from '@lucide/svelte/icons/copy';
  import type { MochiDirectives } from 'mochi-framework';

  // For demos, the source sits next to `href` at `${href}llms.txt`; for docs it's derived from `slug`.
  let { slug, href, kind = 'docs' }: { slug?: string; href?: string; kind?: 'docs' | 'demos' } & MochiDirectives = $props();

  const url = $derived(kind === 'demos' ? `${href}llms.txt` : slug ? `/docs/${slug}/llms.txt` : '/llms.txt');
  let busy = $state(false);

  async function copy() {
    if (busy) {
      return;
    }
    busy = true;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      toast.success('Copied as llms.txt');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      toast.error(`Copy failed: ${message}`);
    } finally {
      busy = false;
    }
  }
</script>

<div class="llms-pill">
  <a class="llms-label" href={url} target="_blank" rel="noopener" aria-label="Open llms.txt in new tab">llms.txt</a>
  <span class="llms-divider" aria-hidden="true"></span>
  <a class="llms-action" href={url} target="_blank" rel="noopener" aria-label="Open llms.txt in new tab">
    <ExternalLink size={12} aria-hidden="true" />
  </a>
  <span class="llms-divider" aria-hidden="true"></span>
  <button class="llms-action" onclick={copy} disabled={busy} aria-busy={busy} aria-label="Copy llms.txt to clipboard" type="button">
    <Copy size={12} aria-hidden="true" />
  </button>
</div>

<style>
  .llms-pill {
    position: absolute;
    top: 0.4rem;
    right: 0.4rem;
    display: inline-flex;
    align-items: stretch;
    font-size: 0.7rem;
    font-weight: 600;
    font-family: inherit;
    color: var(--accent);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
    z-index: 2;
  }

  .llms-label {
    display: inline-flex;
    align-items: center;
    padding: 0.2rem 0.5rem;
    color: inherit;
    text-decoration: none;
    user-select: none;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }

  .llms-label:hover {
    background: var(--accent-soft);
    color: var(--accent-hover);
  }

  .llms-divider {
    width: 1px;
    background: var(--border);
  }

  .llms-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.2rem 0.45rem;
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    font-family: inherit;
    text-decoration: none;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }

  .llms-action:hover:not(:disabled) {
    background: var(--accent-soft);
    color: var(--accent-hover);
  }

  .llms-action:active:not(:disabled) {
    background: var(--accent);
    color: #fff;
  }

  .llms-action:disabled {
    opacity: 0.6;
    cursor: wait;
  }

  @media (max-width: 768px) {
    .llms-pill {
      margin-top: 5px;
      margin-right: 4px;
    }
  }
</style>
