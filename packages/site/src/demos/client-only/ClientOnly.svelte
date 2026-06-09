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
  description="Components marked mochi:clientOnly are never server-rendered — SSR ships only an empty wrapper (plus optional fallback children), and the component mounts in the browser. The canvas below reads window.devicePixelRatio and navigator.hardwareConcurrency at the top of its script, which would crash any SSR render."
  {sources}
>
  <BrowserCanvas mochi:clientOnly hue={260}>
    <div class="skeleton">Mounting in the browser…</div>
  </BrowserCanvas>
</DemoPage>

<style>
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
