<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import LazyDemo from './LazyDemo.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Lazy Islands"
  description="You can mark islands with mochi:hydrate:visible so each one fetches its JS and CSS only when it scrolls into view, via an IntersectionObserver. Lazy islands also have the benefit of not loading their CSS until they come into view, great for secondary content far down the page."
  {sources}
>
  <div class="stack">
    {#each Array(6) as _, i (i)}
      <div class="item">
        <h3>Lazy Island #{i + 1}</h3>
        <LazyDemo mochi:hydrate:visible index={i + 1} />
      </div>
    {/each}
  </div>
</DemoPage>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .item h3 {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 0.5rem;
  }
</style>
