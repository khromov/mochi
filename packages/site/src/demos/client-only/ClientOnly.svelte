<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import BrowserCanvas from './BrowserCanvas.svelte';
  import { loadSources } from '../../components/utils.ts';

  const sources = await loadSources([
    { label: 'ClientOnly.svelte', path: './src/demos/client-only/ClientOnly.svelte' },
    { label: 'BrowserCanvas.svelte', path: './src/demos/client-only/BrowserCanvas.svelte' },
    { label: 'routes.ts', path: './src/demos/client-only/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
</script>

<DemoPage
  title="Client-only Islands"
  description="Components marked mochi:clientOnly are never server-rendered — SSR ships only an empty wrapper (plus optional fallback content), and the component mounts in the browser. The canvas below reads window.devicePixelRatio and getComputedStyle at the top of its script, which would crash any SSR render."
  {sources}
>
  <BrowserCanvas mochi:clientOnly waves={4}>
    <div class="skeleton">Mounting in the browser…</div>
  </BrowserCanvas>
  <p class="facts">
    The animation runs on <code>requestAnimationFrame</code> with a live fps counter, scaled to <code>window.devicePixelRatio</code> — browser APIs read at the top of the component's
    script. This paragraph, by contrast, sits outside the island — it ships with the SSR HTML and doesn't move when the component mounts.
  </p>
</DemoPage>

<style>
  .facts {
    margin-top: 0.75rem;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .skeleton {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 160px;
    font-size: 0.85rem;
    color: var(--text-muted);
    background: var(--surface-muted);
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
  }
</style>
