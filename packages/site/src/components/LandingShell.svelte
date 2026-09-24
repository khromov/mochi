<script lang="ts">
  import '@fontsource/public-sans';
  import '@fontsource-variable/fraunces/full.css';
  import { MetaTags, type MetaTagsProps } from 'svelte-meta-tags';
  import { ViewTransitions } from 'mochi-framework/components';
  import Banner from './Banner.svelte';
  import CodeBlockCopy from './CodeBlockCopy.svelte';
  import Footer from './Footer.svelte';
  import TopNav from './TopNav.svelte';
  import { mergeMetaTags } from '../lib/baseMetaTags';

  let {
    metaTags = {},
    class: className = '',
    children,
  }: {
    metaTags?: MetaTagsProps;
    class?: string;
    children: import('svelte').Snippet;
  } = $props();

  const mergedMetaTags = $derived(mergeMetaTags(metaTags));
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<MetaTags {...mergedMetaTags} />
<ViewTransitions type="fade" />

<div class="landing {className}">
  <Banner />
  <TopNav />
  <main class="landing-main">
    {@render children()}
  </main>
  <Footer />
</div>

<CodeBlockCopy mochi:hydrate />

<style>
  .landing {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--text);
  }

  .landing-main {
    flex: 1;
    min-width: 0;
  }
</style>
