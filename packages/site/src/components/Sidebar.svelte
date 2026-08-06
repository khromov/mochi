<script lang="ts">
  import { onMount } from 'svelte';
  import { filterTocEntries, filterDemos, docHref, groupTocEntries, isActive, type TocEntry, type TocGroup } from '../lib/toc';
  import type { Demo } from '../lib/demos';
  import { isExternal } from '../lib/isExternal';
  import { getLocationHash, getLocationPathname } from '../stores/hash.svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  import GitHubButton from './GitHubButton.svelte';
  import Slash from '@lucide/svelte/icons/slash';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';

  const MAX_VISIBLE_CHILDREN = 4;

  const SCROLL_KEY = 'mochi-sidebar-scroll';

  let { docsNav, demos, currentSlug }: { docsNav: TocEntry[]; demos: Demo[]; currentSlug?: string } = $props();

  let query = $state('');
  let sidebarInner: HTMLDivElement;
  let searchInput: HTMLInputElement;

  // localStorage isn't readable during SSR, so emit an inline script that restores
  // scroll synchronously while the HTML parses, before paint.
  const restoreScript =
    `<script>(function(){var el=document.currentScript.previousElementSibling;if(el&&el.classList.contains('sidebar-inner')){var v=Number(localStorage.getItem('${SCROLL_KEY}')||0);if(v>0){el.scrollTop=v;}}})();</` +
    `script>`;

  onMount(() => {
    // Re-apply after hydration — the pre-paint inline script sets scrollTop
    // early, but Svelte's hydrate pass can wipe it.
    const initialScroll = Number(localStorage.getItem(SCROLL_KEY) ?? 0);
    if (initialScroll > 0) {
      sidebarInner.scrollTop = initialScroll;
    }

    const handleScroll = () => {
      localStorage.setItem(SCROLL_KEY, String(sidebarInner.scrollTop));
    };

    sidebarInner.addEventListener('scroll', handleScroll, { passive: true });

    const handleGlobalKeydown = (event: KeyboardEvent) => {
      if (event.key !== '/') {
        return;
      }
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) {
        return;
      }
      event.preventDefault();
      searchInput.focus();
      searchInput.select();
    };

    document.addEventListener('keydown', handleGlobalKeydown);

    return () => {
      sidebarInner.removeEventListener('scroll', handleScroll);
      document.removeEventListener('keydown', handleGlobalKeydown);
    };
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
  const topResultHref = $derived.by(() => {
    const doc = filteredDocs[0];
    if (doc) {
      return docHref(doc.slug);
    }
    const demo = filteredDemos[0];
    if (demo) {
      return demo.href;
    }
    return null;
  });
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

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && topResultHref) {
      event.preventDefault();

      window.location.href = topResultHref;
    }
  }
</script>

<aside class="sidebar">
  <div class="sidebar-inner" bind:this={sidebarInner}>
    <div class="sidebar-head">
      <a class="sidebar-brand" href="/">🍡 mochi</a>
      <div class="head-actions">
        <GitHubButton />
        <ThemeToggle />
      </div>
    </div>

    <div class="search">
      <input type="search" placeholder="Search docs & demos…" bind:value={query} bind:this={searchInput} onkeydown={handleSearchKeydown} aria-label="Search navigation" />
      <span class="search-hint" aria-hidden="true"><Slash size={11} /></span>
    </div>

    <ul class="toc-list toc-fixed">
      <li class="toc-item level-2">
        <a href="/">Home</a>
      </li>
      <li class="toc-item level-2">
        <a href="/blog/">Blog</a>
      </li>
      <li class="toc-item level-2">
        <a href="/support/">Support</a>
      </li>
      <li class="toc-item level-2">
        <a href="/docs/changelog/">Changelog</a>
      </li>
      <li class="toc-item level-2">
        <a href="/ci/">CI Status</a>
      </li>
    </ul>

    {#if filteredDocs.length > 0}
      <section class="toc-section">
        <h2 class="toc-heading">Docs</h2>
        <ul class="toc-list">
          {#if query}
            {#each filteredDocs as entry (entry.slug)}
              <li class="toc-item level-{entry.level}" class:active={isActive(entry.slug, activeSlug)}>
                <a href={docHref(entry.slug)}>{entry.text}</a>
              </li>
            {/each}
          {:else}
            {#each docGroups as group (group.parent.slug)}
              <li class="toc-item level-2" class:active={isActive(group.parent.slug, activeSlug)}>
                <a href={docHref(group.parent.slug)}>{group.parent.text}</a>
              </li>
              {@const showAll = isGroupExpanded(group)}
              {@const visible = showAll ? group.children : group.children.slice(0, MAX_VISIBLE_CHILDREN)}
              {#each visible as entry (entry.slug)}
                <li class="toc-item level-3" class:active={isActive(entry.slug, activeSlug)}>
                  <a href={docHref(entry.slug)}>{entry.text}</a>
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
              <a href={demo.href} target={external ? '_blank' : undefined}>{demo.title}</a>
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
              <a href={demo.href} target="_blank">{demo.title}</a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if !hasResults}
      <p class="empty">No matches for "{query}"</p>
    {/if}
  </div>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html restoreScript}
</aside>

<style>
  .sidebar {
    background: var(--surface);
    border-right: 1px solid var(--border);
  }

  .sidebar-inner {
    position: sticky;
    top: 0;
    max-height: 100vh;
    overflow-y: auto;
    padding: 1.25rem 1rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .sidebar-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .sidebar-brand {
    font-family: var(--font-serif);
    font-size: 1.35rem;
    font-weight: 500;
    color: var(--text);
    text-decoration: none;
    letter-spacing: -0.01em;
  }

  .search {
    position: relative;
  }

  .search input {
    width: 100%;
    padding: 0.5rem 1.75rem 0.5rem 0.7rem;
    font-size: 0.85rem;
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

  .search-hint {
    position: absolute;
    right: 0.45rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-subtle);
    opacity: 0.45;
    pointer-events: none;
    display: flex;
    align-items: center;
    transition: opacity 0.12s ease;
  }

  .search:has(input:focus) .search-hint,
  .search:has(input:not(:placeholder-shown)) .search-hint {
    opacity: 0;
  }

  .toc-heading {
    font-family: var(--font-serif);
    font-variant-caps: all-small-caps;
    font-feature-settings: 'smcp';
    font-size: 1.05rem;
    font-weight: 500;
    color: var(--text-subtle);
    letter-spacing: 0.08em;
    margin-bottom: 0.5rem;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .toc-heading {
      color: var(--text-muted);
    }
  }

  :global([data-theme='dark']) .toc-heading {
    font-size: 1.05rem;
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
    padding: 0.35rem 0.6rem;
    font-size: 0.85rem;
    color: var(--text-muted);
    text-decoration: none;
    border-radius: var(--radius-sm);
    line-height: 1.35;
    border-left: 2px solid transparent;
    transition:
      background 0.12s ease,
      color 0.12s ease,
      border-color 0.12s ease;
  }

  .toc-item a:hover {
    background: var(--accent-soft);
    color: var(--accent-soft-text);
    border-left-color: var(--accent);
  }

  .toc-fixed .toc-item a {
    padding-left: 0;
    color: var(--text);
    border-left: none;
  }

  .toc-fixed .toc-item a:hover {
    background: none;
    color: var(--text);
    border-left: none;
  }

  .toc-item.active > a {
    background: var(--accent-soft);
    color: var(--accent-soft-text);
    border-left-color: var(--accent);
    font-weight: 600;
  }

  .toc-item.level-2 a {
    font-weight: 500;
  }

  .toc-item.level-3 a {
    padding-left: 1.4rem;
    font-size: 0.8rem;
    color: var(--text-subtle);
  }

  .toc-more button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    width: 100%;
    padding: 0.3rem 0.6rem 0.3rem 1.4rem;
    font-size: 0.78rem;
    font-family: inherit;
    color: var(--text-subtle);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    line-height: 1.35;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }

  .toc-more button:hover {
    background: var(--accent-soft);
    color: var(--accent-soft-text);
  }

  .empty {
    font-size: 0.8rem;
    color: var(--text-subtle);
    padding: 0.25rem 0.1rem;
  }
</style>
