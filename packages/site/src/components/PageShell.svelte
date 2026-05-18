<script lang="ts">
  import '@fontsource/public-sans';
  import '@fontsource-variable/fraunces/full.css';
  import Sidebar from './Sidebar.svelte';
  import MobileNav from './MobileNav.svelte';
  import Banner from './Banner.svelte';
  import CodeBlockCopy from './CodeBlockCopy.svelte';
  import { demos } from '../lib/demos';
  import type { TocEntry } from '../lib/toc';

  let {
    docsNav,
    currentSlug,
    children,
  }: {
    docsNav: TocEntry[];
    currentSlug?: string;
    children: import('svelte').Snippet;
  } = $props();
</script>

<Banner />
<MobileNav mochi:hydrate {docsNav} {demos} {currentSlug} />
<CodeBlockCopy mochi:hydrate />

<div class="page">
  <Sidebar mochi:hydrate {docsNav} {demos} {currentSlug} />

  <div class="main-col">
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

  @media (max-width: 768px) {
    .page {
      grid-template-columns: 1fr;
    }

    :global(.sidebar) {
      display: none;
    }
  }
</style>
