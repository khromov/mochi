<script lang="ts">
  import { filterTocEntries, filterDemos, docHref, groupTocEntries, isActive, type TocEntry, type TocGroup } from '../lib/toc';
  import type { Demo } from '../lib/demos';
  import { isExternal } from '../lib/isExternal';
  import { getLocationHash, getLocationPathname } from '../stores/hash.svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';

  const MAX_VISIBLE_CHILDREN = 4;

  let { docsNav, demos, currentSlug }: { docsNav: TocEntry[]; demos: Demo[]; currentSlug?: string } = $props();

  let open = $state(false);
  let query = $state('');
  let searchInput: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (open && searchInput && window.matchMedia('(any-pointer: fine)').matches) {
      searchInput.focus();
    }
  });

  const docEntries = $derived(docsNav.filter((entry) => entry.level >= 2 && entry.level <= 3));
  const filteredDocs = $derived(filterTocEntries(docEntries, query));
  const filteredDemos = $derived(
    filterDemos(
      demos.filter((d) => d.category !== 'sites'),
      query,
    ),
  );
  const filteredSiteDemos = $derived(
    filterDemos(
      demos.filter((d) => d.category === 'sites'),
      query,
    ),
  );
  const hasResults = $derived(filteredDocs.length > 0 || filteredDemos.length > 0 || filteredSiteDemos.length > 0);
  const activeSlug = $derived(currentSlug ? `${currentSlug}${getLocationHash()}` : undefined);
  const activePathname = $derived(getLocationPathname());

  const docGroups = $derived(groupTocEntries(filteredDocs));
  let expandedGroups = $state<Record<string, boolean>>({});

  function isGroupExpanded(group: TocGroup): boolean {
    return expandedGroups[group.parent.slug] === true || group.parent.slug === currentSlug;
  }

  function expandGroup(slug: string) {
    expandedGroups[slug] = true;
  }

  function toggle() {
    open = !open;
  }

  function close() {
    open = false;
    query = '';
  }
</script>

<div class="mobile-bar">
  <a class="mobile-brand" href="/">🍡 mochi</a>
  <button class="mobile-toggle" aria-label="Toggle menu" aria-expanded={open} onclick={toggle}>
    <span class="bar"></span>
    <span class="bar"></span>
    <span class="bar"></span>
  </button>
</div>

<svelte:window onkeydown={(e) => open && e.key === 'Escape' && close()} />

{#if open}
  <!-- Backdrop is a pointer-only convenience; keyboard close is handled by svelte:window above. -->
  <div class="drawer-backdrop" onclick={close} aria-hidden="true"></div>
  <div class="drawer">
    <a
      href="https://github.com/khromov/mochi"
      target="_blank"
      rel="noopener noreferrer"
      class="gh-corner-mobile"
      aria-label="View source on GitHub"
      onclick={close}
    >
      <svg width="52" height="52" viewBox="0 0 250 250" aria-hidden="true">
        <path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z"></path>
        <path
          d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.9,78.5 120.9,78.5 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2"
          fill="currentColor"
          class="octo-arm"
        ></path>
        <path
          d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.8 141.5,141.9 141.8,141.8 Z"
          fill="currentColor"
          class="octo-body"
        ></path>
      </svg>
    </a>
    <div class="drawer-inner">
      <div class="drawer-head">
        <span class="drawer-label">Appearance</span>
        <ThemeToggle />
      </div>

      <div class="search">
        <input type="search" placeholder="Search docs & demos…" bind:value={query} bind:this={searchInput} aria-label="Search navigation" />
      </div>

      <ul class="toc-list toc-fixed">
        <li class="toc-item level-2">
          <a href="/" onclick={close}>Home</a>
        </li>
      </ul>

      {#if filteredDocs.length > 0}
        <section class="toc-section">
          <h2 class="toc-heading">Docs</h2>
          <ul class="toc-list">
            {#if query}
              {#each filteredDocs as entry (entry.slug)}
                <li class="toc-item level-{entry.level}" class:active={isActive(entry.slug, activeSlug)}>
                  <a href={docHref(entry.slug)} onclick={close}>{entry.text}</a>
                </li>
              {/each}
            {:else}
              {#each docGroups as group (group.parent.slug)}
                <li class="toc-item level-2" class:active={isActive(group.parent.slug, activeSlug)}>
                  <a href={docHref(group.parent.slug)} onclick={close}>{group.parent.text}</a>
                </li>
                {@const showAll = isGroupExpanded(group)}
                {@const visible = showAll ? group.children : group.children.slice(0, MAX_VISIBLE_CHILDREN)}
                {#each visible as entry (entry.slug)}
                  <li class="toc-item level-3" class:active={isActive(entry.slug, activeSlug)}>
                    <a href={docHref(entry.slug)} onclick={close}>{entry.text}</a>
                  </li>
                {/each}
                {#if !showAll && group.children.length > MAX_VISIBLE_CHILDREN}
                  <li class="toc-item toc-more">
                    <button type="button" onclick={() => expandGroup(group.parent.slug)}>
                      <ChevronDown size={12} aria-hidden="true" />
                      <span>Show {group.children.length - MAX_VISIBLE_CHILDREN} more</span>
                    </button>
                  </li>
                {/if}
              {/each}
            {/if}
          </ul>
        </section>
      {/if}

      {#if filteredDemos.length > 0}
        <section class="toc-section">
          <h2 class="toc-heading">Demos</h2>
          <ul class="toc-list">
            {#each filteredDemos as demo (demo.href)}
              {@const external = isExternal(demo.href)}
              <li class="toc-item level-2" class:active={!external && activePathname.startsWith(demo.href)}>
                <a href={demo.href} target={external ? '_blank' : undefined} onclick={close}>{demo.title}</a>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if filteredSiteDemos.length > 0}
        <section class="toc-section">
          <h2 class="toc-heading">Demo sites</h2>
          <ul class="toc-list">
            {#each filteredSiteDemos as demo (demo.href)}
              <li class="toc-item level-2">
                <a href={demo.href} target="_blank" onclick={close}>{demo.title}</a>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if !hasResults}
        <p class="empty">No matches for "{query}"</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .mobile-bar {
    display: none;
    position: sticky;
    top: 0;
    left: 0;
    right: 0;
    height: 52px;
    padding: 0 1rem;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: saturate(180%) blur(8px);
    border-bottom: 1px solid var(--border);
    z-index: 20;
    align-items: center;
    justify-content: space-between;
  }

  .mobile-brand {
    font-family: var(--font-serif);
    font-size: 1.25rem;
    font-weight: 500;
    color: var(--text);
    text-decoration: none;
  }

  .mobile-toggle {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    width: 40px;
    height: 40px;
    padding: 10px;
    background: transparent;
    border: none;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: background 0.12s ease;
  }

  .mobile-toggle:hover {
    background: var(--accent-soft);
  }

  .bar {
    display: block;
    width: 100%;
    height: 2px;
    background: var(--text);
    border-radius: 2px;
  }

  .drawer-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(31, 42, 36, 0.4);
    z-index: 30;
  }

  .drawer {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 82%;
    max-width: 320px;
    background: var(--surface);
    z-index: 31;
    box-shadow: 2px 0 24px rgba(47, 61, 51, 0.18);
    overflow-y: auto;
  }

  .drawer-inner {
    padding: 4rem 1rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.4rem 0.1rem;
    gap: 0.75rem;
  }

  .drawer-label {
    font-family: var(--font-serif);
    font-variant-caps: all-small-caps;
    font-feature-settings: 'smcp';
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--text-subtle);
    letter-spacing: 0.08em;
  }

  .search input {
    width: 100%;
    padding: 0.55rem 0.75rem;
    font-size: 0.9rem;
    font-family: inherit;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    color: var(--text);
    outline: none;
    transition:
      border-color 0.12s ease,
      background 0.12s ease,
      box-shadow 0.12s ease;
  }

  .search input::placeholder {
    color: var(--text-subtle);
  }

  .search input:focus {
    border-color: var(--accent);
    background: var(--surface);
    box-shadow: var(--focus-ring);
  }

  .toc-heading {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 0.5rem;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .toc-heading {
      color: var(--text-muted);
    }
  }

  :global([data-theme='dark']) .toc-heading {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .toc-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .toc-item a {
    display: block;
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
    color: var(--text-muted);
    text-decoration: none;
    border-radius: var(--radius-sm);
    line-height: 1.35;
  }

  .toc-item a:active {
    background: var(--accent-soft);
    color: var(--accent-soft-text);
  }

  .toc-fixed .toc-item a {
    padding-left: 0;
    color: var(--text);
  }

  .toc-fixed .toc-item a:active {
    background: none;
    color: var(--text);
  }

  .toc-item.active > a {
    background: var(--accent-soft);
    color: var(--accent-soft-text);
    font-weight: 600;
  }

  .toc-item.level-3 a {
    padding-left: 1.5rem;
    font-size: 0.85rem;
    color: var(--text-subtle);
  }

  .toc-more button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.4rem 0.75rem 0.4rem 1.5rem;
    font-size: 0.82rem;
    font-family: inherit;
    color: var(--text-subtle);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    line-height: 1.35;
  }

  .toc-more button:active {
    background: var(--accent-soft);
    color: var(--accent-soft-text);
  }

  .empty {
    font-size: 0.85rem;
    color: var(--text-subtle);
    padding: 0.25rem 0.1rem;
  }

  @media (max-width: 768px) {
    .mobile-bar {
      display: flex;
    }
  }

  /* GitHub corner pinned to the top-right of the drawer (the fixed page corner is
     hidden on mobile — see shell.html). `octocat-wave` keyframes are global. */
  .gh-corner-mobile {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 1;
    border: 0;
    color: #fff;
  }

  .gh-corner-mobile svg {
    display: block;
    fill: #151513;
    color: #fff;
  }

  .gh-corner-mobile .octo-arm {
    transform-origin: 130px 106px;
  }

  .gh-corner-mobile:hover .octo-arm {
    animation: octocat-wave 560ms ease-in-out;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .gh-corner-mobile svg {
      fill: #fff;
      color: #151513;
    }
  }

  :global([data-theme='dark']) .gh-corner-mobile svg {
    fill: #fff;
    color: #151513;
  }
</style>
