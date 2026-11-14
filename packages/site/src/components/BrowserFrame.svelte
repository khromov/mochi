<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    url = 'localhost:3333',
    size = 'md',
    children,
  }: {
    url?: string;
    size?: 'sm' | 'md';
    children: Snippet;
  } = $props();
</script>

<div class="frame frame-{size}">
  <div class="bar" aria-hidden="true">
    <span class="dots"><span></span><span></span><span></span></span>
    <span class="url">{url}</span>
  </div>
  <div class="viewport">
    {@render children()}
  </div>
</div>

<style>
  .frame {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    min-width: 0;
  }

  .frame-sm {
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.85rem;
    background: var(--surface-muted);
    border-bottom: 1px solid var(--border);
  }

  .frame-sm .bar {
    padding: 0.4rem 0.65rem;
  }

  .dots {
    display: inline-flex;
    gap: 0.35rem;
    flex-shrink: 0;
  }

  .dots span {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--border-strong);
  }

  .frame-sm .dots span {
    width: 0.45rem;
    height: 0.45rem;
  }

  .url {
    flex: 1;
    min-width: 0;
    max-width: 22rem;
    margin: 0 auto;
    padding: 0.2rem 0.75rem;
    font-family: var(--font-mono);
    font-size: 0.74rem;
    color: var(--text-subtle);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .frame-sm .url {
    font-size: 0.68rem;
    padding: 0.1rem 0.5rem;
  }

  .viewport {
    padding: 1.5rem;
  }

  .frame-sm .viewport {
    padding: 1.1rem 1.2rem;
  }
</style>
