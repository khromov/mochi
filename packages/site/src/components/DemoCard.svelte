<script lang="ts">
  import type { Component } from 'svelte';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';

  let {
    href,
    title,
    label,
    icon: Icon,
    external = false,
  }: {
    href: string;
    title: string;
    label: string;
    icon: Component;
    external?: boolean;
  } = $props();
</script>

<a class="demo" {href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
  <span class="demo-icon"><Icon size={18} strokeWidth={1.8} /></span>
  <span class="demo-text">
    <span class="demo-title">
      {title}
      {#if external}<ArrowUpRight class="demo-external" size={14} strokeWidth={2} aria-label="(opens in a new tab)" />{/if}
    </span>
    <span class="demo-label">{label}</span>
  </span>
</a>

<style>
  .demo {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.85rem 1rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    text-decoration: none;
    color: inherit;
    transition: border-color 0.15s ease;
  }

  .demo:hover {
    border-color: var(--accent);
  }

  .demo:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .demo-icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.2rem;
    height: 2.2rem;
    border-radius: var(--radius-sm);
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--accent);
  }

  .demo-text {
    display: grid;
    min-width: 0;
  }

  .demo-title {
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .demo-title :global(.demo-external) {
    margin-left: 0.15rem;
    vertical-align: -1px;
    color: var(--text-subtle);
  }

  .demo-label {
    font-size: 0.84rem;
    line-height: 1.4;
    color: var(--text-subtle);
  }
</style>
