<script lang="ts">
  import { onMount } from 'svelte';

  type Tally = { html: number; js: number; files: number; dev: number };

  let tally = $state<Tally | null>(null);

  const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
  const scale = $derived(tally ? Math.max(tally.html, tally.js, 1) : 1);

  function measure(): Tally {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const html = nav ? nav.transferSize || nav.encodedBodySize : 0;
    const seen: Record<string, true> = {};
    let js = 0;
    let dev = 0;
    let files = 0;
    for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      const path = new URL(entry.name, location.href).pathname;
      if (seen[entry.name] || !(entry.initiatorType === 'script' || /\.m?js$/.test(path))) {
        continue;
      }
      seen[entry.name] = true;
      const bytes = entry.transferSize || entry.encodedBodySize;
      if (/debugbar|live-?reload/i.test(path)) {
        dev += bytes;
      } else {
        js += bytes;
        files += 1;
      }
    }
    return { html, js, files, dev };
  }

  onMount(() => {
    const update = () => (tally = measure());
    update();
    addEventListener('load', update);
    const observer = new PerformanceObserver(update);
    observer.observe({ type: 'resource' });
    return () => {
      removeEventListener('load', update);
      observer.disconnect();
    };
  });
</script>

<figure class="meter">
  <div class="row">
    <span class="label">HTML document</span>
    <span class="value">{tally ? kb(tally.html) : '—'}</span>
    <span class="bar"><span class="fill fill-html" style:width="{tally ? (tally.html / scale) * 100 : 0}%"></span></span>
  </div>
  <div class="row">
    <span class="label"
      >JavaScript{#if tally}&ensp;·&ensp;{tally.files} files{/if}</span
    >
    <span class="value">{tally ? kb(tally.js) : '—'}</span>
    <span class="bar"><span class="fill fill-js" style:width="{tally ? (tally.js / scale) * 100 : 0}%"></span></span>
  </div>
  <figcaption>
    {#if tally}
      Measured in your browser just now.
      {#if tally.dev > 0}
        Excludes {kb(tally.dev)} of dev-server tooling.
      {/if}
    {:else}
      Measuring…
    {/if}
  </figcaption>
</figure>

<style>
  .meter {
    display: grid;
    gap: 0.9rem;
    margin: 0;
  }

  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.35rem 1rem;
    align-items: baseline;
  }

  .label {
    font-size: 0.85rem;
    font-weight: 600;
  }

  .value {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.85rem;
    font-weight: 500;
  }

  .bar {
    grid-column: 1 / -1;
    height: 18px;
    border: 1px solid currentColor;
  }

  .fill {
    display: block;
    height: 100%;
    transition: width 0.6s cubic-bezier(0.3, 0.7, 0.2, 1);
  }

  .fill-html {
    background: currentColor;
  }

  .fill-js {
    background: #f7df1e;
    box-shadow: inset -1px 0 0 #0a0a0a;
  }

  figcaption {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.72rem;
    line-height: 1.5;
    opacity: 0.7;
  }

  @media (prefers-reduced-motion: reduce) {
    .fill {
      transition: none;
    }
  }
</style>
