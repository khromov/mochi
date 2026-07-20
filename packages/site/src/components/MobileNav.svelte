<script lang="ts">
  import { filterTocEntries, filterDemos, docHref, groupTocEntries, isActive, type TocEntry, type TocGroup } from '../lib/toc';
  import type { Demo } from '../lib/demos';
  import { isExternal } from '../lib/isExternal';
  import { getLocationHash, getLocationPathname } from '../stores/hash.svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  import GitHubButton from './GitHubButton.svelte';
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
    <div class="drawer-inner">
      <div class="drawer-head">
        <span class="drawer-label">🍡 mochi</span>
        <div class="head-actions">
          <GitHubButton onNavigate={close} />
          <ThemeToggle />
        </div>
      </div>

      <div class="search">
        <input type="search" placeholder="Search docs & demos…" bind:value={query} bind:this={searchInput} aria-label="Search navigation" />
      </div>

      <ul class="toc-list toc-fixed">
        <li class="toc-item level-2">
          <a href="/" onclick={close}>Home</a>
        </li>
        <li class="toc-item level-2">
          <a href="/blog/" onclick={close}>Blog</a>
        </li>
        <li class="toc-item level-2">
          <a href="/support/" onclick={close}>Support</a>
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
    padding: 1.5rem 1rem 2rem;
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

  .head-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .drawer-label {
    font-family: var(--font-serif);
    font-size: 1.25rem;
    font-weight: 500;
    color: var(--text);
    letter-spacing: -0.01em;
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
</style>
