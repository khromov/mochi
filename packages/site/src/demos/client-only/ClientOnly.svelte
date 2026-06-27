<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import BrowserCanvas from './BrowserCanvas.svelte';
  import MountClock from './MountClock.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
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

  <div class="spacer">
    <p>Scroll down — the island below is marked <code>mochi:clientOnly:visible</code>, so it stays a fallback until it reaches the viewport, then mounts in the browser.</p>
  </div>

  <h2 class="visible-heading">Lazy client-only with <code>mochi:clientOnly:visible</code></h2>
  <MountClock mochi:clientOnly:visible={{ rootMargin: '0px' }} label="Lazy island">
    <div class="skeleton">Mounts when scrolled into view…</div>
  </MountClock>
  <p class="facts">
    Same browser-only mount as above, but deferred: an <code>IntersectionObserver</code> holds off the <code>mount()</code> until the placeholder enters the viewport, and the component's
    bundle and CSS load only then. Open the console to see it mount as you scroll.
  </p>
</DemoPage>

<style>
  .facts {
    margin-top: 0.75rem;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .spacer {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 70vh;
    margin: 1rem 0;
    padding: 1rem;
    text-align: center;
    font-size: 0.85rem;
    color: var(--text-muted);
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
  }

  .visible-heading {
    font-size: 1rem;
    margin: 0 0 0.75rem;
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
