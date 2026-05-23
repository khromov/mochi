<script lang="ts">
  import { url } from 'mochi-framework';
  import { MetaTags, type MetaTagsProps } from 'svelte-meta-tags';
  import { mergeMetaTags } from '../lib/baseMetaTags';
  import MochiBanner from './MochiBanner.svelte';

  let { activeNav, metaTags = {}, children } = $props<{
    activeNav?: string;
    metaTags?: MetaTagsProps;
    children: () => unknown;
  }>();

  const mergedMetaTags = $derived(mergeMetaTags({ canonical: `https://demos.mochi.fast${url.pathname}`, ...metaTags }));
</script>

<MetaTags {...mergedMetaTags} />

<div class="hn-page">
  <MochiBanner />
  <header class="hn-header">
    <nav class="hn-nav">
      <a href="/hn/front/" class="hn-logo"><b>Y</b></a>
      <a href="/hn/front/" class="hn-site-name"><b>Hacker News</b></a>
      <span class="hn-links">
        <a href="/hn/new/" class:active={activeNav === 'newstories'}>new</a> |
        <a href="/hn/ask/" class:active={activeNav === 'askstories'}>ask</a> |
        <a href="/hn/show/" class:active={activeNav === 'showstories'}>show</a> |
        <a href="/hn/jobs/" class:active={activeNav === 'jobstories'}>jobs</a>
      </span>
    </nav>
  </header>

  <main class="hn-content">
    {@render children()}
  </main>

  <footer class="hn-footer">
    <a href="/">Back to Mochi</a>
  </footer>
</div>

<style>
  :global(*, *::before, *::after) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    min-height: 100vh;
    background: var(--hn-bg);
    color: var(--hn-text);
    font-family: var(--hn-font);
    font-size: 10pt;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  .hn-page {
    max-width: min(85%, calc(100% - 16px));
    margin: 0 auto;
  }

  @media (max-width: 640px) {
    .hn-page {
      max-width: calc(100% - 12px);
    }
  }

  .hn-header {
    background: var(--hn-orange);
    padding: 2px 4px;
  }

  .hn-nav {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .hn-logo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: 1px solid white;
    color: white;
    text-decoration: none;
    font-size: 11pt;
  }

  .hn-site-name {
    color: var(--hn-text);
    text-decoration: none;
    font-size: 10pt;
    margin-right: 4px;
  }

  .hn-links {
    font-size: 10pt;
  }

  .hn-links a {
    color: var(--hn-text);
    text-decoration: none;
  }

  .hn-links a:hover,
  .hn-links a.active {
    color: #fff;
  }

  .hn-content {
    padding: 10px 0;
  }

  .hn-footer {
    border-top: 2px solid var(--hn-orange);
    padding: 10px 0;
    text-align: center;
    margin-top: 20px;
  }

  .hn-footer a {
    color: var(--hn-text-meta);
    font-size: 8pt;
    text-decoration: none;
  }

  .hn-footer a:hover {
    text-decoration: underline;
  }
</style>
