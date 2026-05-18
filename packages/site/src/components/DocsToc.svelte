<script lang="ts">
  import type { TocEntry } from '../lib/toc';

  let { toc }: { toc: TocEntry[] } = $props();

  const entries = $derived(toc.filter((e) => e.level === 2 || e.level === 3));
</script>

{#if entries.length >= 2}
  <details class="docs-toc">
    <summary>On this page</summary>
    <nav aria-label="On this page">
      <ul>
        {#each entries as entry (entry.slug)}
          <li class="level-{entry.level}">
            <a href="#{entry.slug}">{entry.text}</a>
          </li>
        {/each}
      </ul>
    </nav>
  </details>
{/if}

<style>
  .docs-toc {
    margin: 1rem 0 1rem 0;
    padding: 0.6rem 0.9rem;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-size: 0.95rem;
  }

  summary {
    cursor: pointer;
    font-family: var(--font-serif);
    font-variant-caps: all-small-caps;
    font-feature-settings: 'smcp';
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--text-subtle);
    letter-spacing: 0.08em;
    list-style: none;
    user-select: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary::before {
    content: '▸';
    display: inline-block;
    margin-right: 0.4rem;
    font-size: 0.75em;
    color: var(--text-subtle);
    transition: transform 0.12s ease;
  }

  .docs-toc[open] summary::before {
    transform: rotate(90deg);
  }

  nav {
    margin-top: 0.5rem;
  }

  .docs-toc :global(ul) {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .docs-toc :global(li) {
    margin: 0;
  }

  .docs-toc :global(a) {
    display: block;
    padding: 0.2rem 0.4rem;
    font-size: 0.9rem;
    color: var(--text-muted);
    text-decoration: none;
    border-radius: var(--radius-sm);
    line-height: 1.4;
  }

  .docs-toc :global(a:hover) {
    color: var(--accent-hover);
    background: var(--accent-soft);
    text-decoration: none;
  }

  .docs-toc :global(li.level-3 a) {
    padding-left: 1.4rem;
    font-size: 0.85rem;
    color: var(--text-subtle);
  }
</style>
