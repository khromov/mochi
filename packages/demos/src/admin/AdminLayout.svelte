<script lang="ts">
  import '@fontsource-variable/fraunces/full.css';
  import '@fontsource-variable/public-sans';
  import { url } from 'mochi-framework';
  import { MetaTags, type MetaTagsProps } from 'svelte-meta-tags';
  import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
  import Users from '@lucide/svelte/icons/users';
  import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
  import Package from '@lucide/svelte/icons/package';
  import Activity from '@lucide/svelte/icons/activity';
  import Settings from '@lucide/svelte/icons/settings';
  import AdminThemeToggle from './AdminThemeToggle.svelte';
  import { mergeMetaTags } from '../lib/baseMetaTags';
  import type { Component, Snippet } from 'svelte';

  type Section = {
    key: string;
    title: string;
    icon: Component;
    live: boolean;
  };

  interface Props {
    activeNav?: string;
    metaTags?: MetaTagsProps;
    children: Snippet;
  }

  let { activeNav, metaTags = {}, children }: Props = $props();

  const mergedMetaTags = $derived(mergeMetaTags({ canonical: `https://demos.mochi.fast${url.pathname}`, ...metaTags }));

  const sections: Section[] = [
    { key: 'dashboard', title: 'Dashboard', icon: LayoutDashboard, live: true },
    { key: 'users', title: 'Users', icon: Users, live: false },
    { key: 'orders', title: 'Orders', icon: ShoppingCart, live: false },
    { key: 'products', title: 'Products', icon: Package, live: false },
    { key: 'activity', title: 'Activity', icon: Activity, live: false },
    { key: 'settings', title: 'Settings', icon: Settings, live: false },
  ];
</script>

<MetaTags {...mergedMetaTags} />

<div class="admin-shell">
  <aside class="admin-sidebar">
    <div class="admin-head">
      <a class="admin-brand" href="/admin/">
        <span class="brand-mark">🍡</span>
        <span class="brand-text">mochi <em>admin</em></span>
      </a>
      <AdminThemeToggle mochi:hydrate />
    </div>

    <nav class="admin-nav">
      {#each sections as s (s.key)}
        {@const Icon = s.icon}
        {#if s.live}
          <a class="nav-item" class:active={activeNav === s.key} href="/admin/">
            <Icon size={16} strokeWidth={1.7} />
            <span>{s.title}</span>
          </a>
        {:else}
          <span class="nav-item disabled" aria-disabled="true">
            <Icon size={16} strokeWidth={1.7} />
            <span>{s.title}</span>
            <em class="soon">soon</em>
          </span>
        {/if}
      {/each}
    </nav>

    <a class="admin-back" href="/">← Back to Mochi</a>
  </aside>

  <main class="admin-main">
    {@render children()}
  </main>
</div>

<style>
  :global(*, *::before, *::after) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    min-height: 100vh;
    background: var(--admin-bg);
    color: var(--admin-text);
    font-family: var(--admin-font-sans);
    line-height: 1.55;
    color-scheme: light dark;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  .admin-shell {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 240px 1fr;
    overflow-x: clip;
  }

  .admin-sidebar {
    position: sticky;
    top: 0;
    height: 100vh;
    background: var(--admin-surface);
    border-right: 1px solid var(--admin-border);
    padding: 1.1rem 0.75rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .admin-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.2rem 0.6rem 1rem;
  }

  .admin-brand {
    display: inline-flex;
    align-items: baseline;
    gap: 0.4rem;
    text-decoration: none;
    color: var(--admin-text);
    font-family: var(--admin-font-serif);
    font-size: 1.05rem;
    font-weight: 500;
    letter-spacing: -0.005em;
  }

  .brand-mark {
    font-size: 1.15rem;
  }

  .brand-text em {
    font-style: normal;
    color: var(--admin-accent);
    font-weight: 600;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-family: var(--admin-font-sans);
    margin-left: 0.05rem;
  }

  .admin-nav {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    flex: 1;
  }

  .nav-item {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.65rem;
    border-radius: var(--admin-radius-sm);
    color: var(--admin-text-muted);
    font-size: 0.9rem;
    text-decoration: none;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }

  .nav-item :global(svg) {
    flex-shrink: 0;
    color: var(--admin-text-subtle);
    transition: color 0.12s ease;
  }

  a.nav-item:hover {
    background: var(--admin-surface-muted);
    color: var(--admin-text);
  }

  a.nav-item:hover :global(svg) {
    color: var(--admin-accent);
  }

  a.nav-item.active {
    background: var(--admin-accent-soft);
    color: var(--admin-accent-soft-text);
    font-weight: 600;
  }

  a.nav-item.active :global(svg) {
    color: var(--admin-accent-soft-text);
  }

  .nav-item.disabled {
    color: var(--admin-text-subtle);
    cursor: default;
  }

  .nav-item.disabled :global(svg) {
    color: var(--admin-text-subtle);
    opacity: 0.7;
  }

  .soon {
    margin-left: auto;
    font-style: normal;
    font-size: 0.62rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    background: var(--admin-surface-muted);
    color: var(--admin-text-subtle);
    border: 1px solid var(--admin-border);
  }

  .admin-back {
    margin-top: auto;
    padding: 0.55rem 0.65rem;
    font-size: 0.78rem;
    color: var(--admin-text-subtle);
    text-decoration: none;
    border-top: 1px solid var(--admin-border);
    border-radius: 0;
  }

  .admin-back:hover {
    color: var(--admin-accent);
  }

  .admin-main {
    padding: 1.5rem 1.75rem 2.5rem;
    min-width: 0;
    max-width: 1200px;
    width: 100%;
  }

  @media (max-width: 768px) {
    .admin-shell {
      grid-template-columns: 1fr;
    }

    .admin-sidebar {
      position: static;
      height: auto;
      padding: 0.6rem 0.75rem;
      gap: 0.5rem;
      border-right: none;
      border-bottom: 1px solid var(--admin-border);
      min-width: 0;
    }

    .admin-head {
      padding: 0;
    }

    .admin-nav {
      flex-direction: row;
      flex: 0 0 auto;
      gap: 0.3rem;
      overflow-x: auto;
      scrollbar-width: none;
      min-width: 0;
      padding: 0.25rem 0;
    }

    .admin-nav::-webkit-scrollbar {
      display: none;
    }

    .nav-item {
      flex-shrink: 0;
      white-space: nowrap;
      padding: 0.65rem 0.9rem;
      font-size: 1rem;
      gap: 0.55rem;
    }

    .soon {
      display: none;
    }

    .admin-back {
      margin-top: 0;
      padding: 0.35rem 0.65rem;
      border-top: none;
    }

    .admin-main {
      padding: 1rem 1rem 2rem;
    }
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light']) .gh-corner svg) {
      fill: #fff;
      color: #151513;
    }
  }
  :global(:root[data-theme='dark'] .gh-corner svg) {
    fill: #fff;
    color: #151513;
  }
</style>
