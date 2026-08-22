<script lang="ts">
  import '@fontsource/public-sans';
  import '@fontsource-variable/fraunces/full.css';
  import { MetaTags, type MetaTagsProps } from 'svelte-meta-tags';
  import { url } from 'mochi-framework';
  import { ViewTransitions } from 'mochi-framework/components';
  import Sidebar from './Sidebar.svelte';
  import MobileNav from './MobileNav.svelte';
  import Banner from './Banner.svelte';
  import CodeBlockCopy from './CodeBlockCopy.svelte';
  import { demos } from '../lib/demos';
  import { mergeMetaTags } from '../lib/baseMetaTags';
  import type { TocEntry } from '../lib/toc';

  let {
    docsNav,
    currentSlug,
    metaTags = {},
    children,
  }: {
    docsNav: TocEntry[];
    currentSlug?: string;
    metaTags?: MetaTagsProps;
    children: import('svelte').Snippet;
  } = $props();

  const mergedMetaTags = $derived(mergeMetaTags(metaTags));

  // Nav islands hydrate and serialize their props into the page; drop `.files` (nav never
  // reads it) since crawlers otherwise mine its relative paths as URLs, producing phantom 404s.
  const navDemos = demos.map(({ files: _files, ...rest }) => rest);

  // Match each route and its subpaths exactly so a future demo sharing the prefix
  // (e.g. /demos/view-transitions-foo) doesn't steal these demos' own <ViewTransitions>.
  const ownsViewTransitions = $derived(['/demos/view-transitions', '/demos/custom-transitions'].some((base) => url.pathname === base || url.pathname.startsWith(`${base}/`)));
</script>

<MetaTags {...mergedMetaTags} />

{#if !ownsViewTransitions}
  <ViewTransitions type="fade" regions="mochi-body" />
{/if}

<Banner />
<MobileNav mochi:hydrate {docsNav} demos={navDemos} {currentSlug} />
<CodeBlockCopy mochi:hydrate />

<div class="page">
  <Sidebar mochi:hydrate {docsNav} demos={navDemos} {currentSlug} />

  <!-- Naming `.body` confines the transition to it, leaving banner/sidebar/debug bar frozen;
       gate it off on demo pages so their own transitions own the whole subtree. -->
  <div class="main-col" class:scope-view-transition={!ownsViewTransitions}>
    {@render children()}
  </div>
</div>

<style>
  .page {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 260px 1fr;
  }

  .main-col {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .main-col.scope-view-transition :global(.body) {
    view-transition-name: mochi-body;
  }

  @media (max-width: 768px) {
    .page {
      grid-template-columns: 1fr;
    }

    :global(.sidebar) {
      display: none;
    }
  }
</style>
