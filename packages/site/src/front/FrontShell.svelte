<script lang="ts">
  import '@fontsource/public-sans';
  import '@fontsource/public-sans/600.css';
  import '@fontsource/public-sans/700.css';
  import '@fontsource-variable/fraunces/full.css';
  import { MetaTags } from 'svelte-meta-tags';
  import { ViewTransitions } from 'mochi-framework/components';
  import MobileNav from '../components/MobileNav.svelte';
  import Banner from '../components/Banner.svelte';
  import CodeBlockCopy from '../components/CodeBlockCopy.svelte';
  import TopNav from './TopNav.svelte';
  import ConceptSwitcher from './ConceptSwitcher.svelte';
  import { demos } from '../lib/demos';
  import { mergeMetaTags } from '../lib/baseMetaTags';
  import type { TocEntry } from '../lib/toc';

  let {
    docsNav,
    firstDocSlug,
    concept,
    title,
    style,
    themeToggle = true,
    children,
  }: {
    docsNav: TocEntry[];
    firstDocSlug: string;
    concept: number;
    title: string;
    style?: string;
    themeToggle?: boolean;
    children: import('svelte').Snippet;
  } = $props();

  const metaTags = $derived(
    mergeMetaTags({
      title,
      titleTemplate: '%s',
      canonical: `https://mochi.fast/front-${concept}/`,
      robots: 'noindex, nofollow',
    }),
  );

  const navDemos = demos.map(({ files: _files, ...rest }) => rest);
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<MetaTags {...metaTags} />
<ViewTransitions type="fade" regions="mochi-body" />

<div class="front" {style}>
  <Banner />
  <MobileNav mochi:hydrate {docsNav} demos={navDemos} />
  <CodeBlockCopy mochi:hydrate />
  <TopNav {firstDocSlug} {themeToggle} />
  <div class="body">
    {@render children()}
  </div>
  <ConceptSwitcher current={concept} />
</div>

<style>
  .front {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--text);
  }

  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    view-transition-name: mochi-body;
  }
</style>
