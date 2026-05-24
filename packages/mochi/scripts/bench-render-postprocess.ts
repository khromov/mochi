/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Micro-benchmark: old vs new HTML post-processing in renderComponent.
 *
 * Isolates the regex replacement, HTMLRewriter, and lookup patterns
 * on realistic rendered HTML. Run with: bun packages/mochi/scripts/bench-render-postprocess.ts
 */

import { isSvelteMarker, normalizeIslandHydrationMarkers, stripHydrationMarkers } from '../src/utils';

// ---------------------------------------------------------------------------
// Simulated state (mirrors ComponentRegistry fields)
// ---------------------------------------------------------------------------

interface HydratableComponent {
  name: string;
  resolvedPath: string;
}

const ISLAND_COUNT = 8;
const hydratables: HydratableComponent[] = Array.from({ length: ISLAND_COUNT }, (_, i) => ({
  name: `Island${i}`,
  resolvedPath: `/abs/path/to/Island${i}.svelte`,
}));

const componentEntryUrls = new Map(hydratables.map((h) => [h.name, `/_mochi/client/Island${h.name}-abc123.js`]));
const cssFileUrls = new Map(hydratables.map((h) => [h.resolvedPath, `/_mochi/client/${h.name}-def456.css`]));
const serverIslandPaths = new Map([
  ['ServerComp0', '/abs/path/to/ServerComp0.svelte'],
  ['ServerComp1', '/abs/path/to/ServerComp1.svelte'],
]);
for (const [, p] of serverIslandPaths) {
  cssFileUrls.set(p, `/_mochi/client/server-abc.css`);
}
const assetPrefix = '/_mochi';

// ---------------------------------------------------------------------------
// Realistic HTML body (~4 KB with islands, markers, placeholders)
// ---------------------------------------------------------------------------

function buildHtml(): string {
  const parts: string[] = ['<!--[--><div class="page"><!--[-->'];

  for (let i = 0; i < ISLAND_COUNT; i++) {
    const isLazy = i % 3 === 0;
    parts.push(`
<!--[--><svelte:boundary><!--[-->
<mochi-hydratable-island island-id="mochi-abc${i}" component-name="Island${i}"
  component-url="__MOCHI_COMPONENT_URL__Island${i}__"
  ${isLazy ? `css-url="__MOCHI_CSS_URL__Island${i}__" hydrate-on="visible"` : ''}
  props-ref="mochi-props-${i}">
  <!--[--><!--[--><div class="island-content-${i}">
    <p>Some content for island ${i}</p>
    <span>More nested content</span>
  </div><!--]--><!--]-->
</mochi-hydratable-island>
<!--]--></svelte:boundary><!--]-->
`);
  }

  // Add server islands
  for (const [name] of serverIslandPaths) {
    parts.push(`
<!--[--><mochi-server-island island-id="mochi-srv-${name}" component-name="${name}"
  signed-props="abc123" css-url="__MOCHI_SERVER_CSS_URL__${name}__"
  data-asset-prefix="__MOCHI_ASSET_PREFIX__">
</mochi-server-island><!--]-->
`);
  }

  parts.push('<!--]--></div><!--]-->');
  return parts.join('');
}

const HTML = buildHtml();

// ---------------------------------------------------------------------------
// OLD approach (before optimization)
// ---------------------------------------------------------------------------

function oldPostProcess(body: string): string {
  let output = body;

  output = output.replace(/__MOCHI_COMPONENT_URL__(\w+)__/g, (_, name: string) => componentEntryUrls.get(name) ?? '');

  const islandPaths = new Set(hydratables.map((h) => h.resolvedPath));
  const lazyIslandPaths = new Set(hydratables.filter((h) => output.includes(`__MOCHI_CSS_URL__${h.name}__`)).map((h) => h.resolvedPath));

  output = output.replace(/__MOCHI_CSS_URL__(\w+)__/g, (_, name: string) => {
    const h = hydratables.find((c) => c.name === name);
    return h ? (cssFileUrls.get(h.resolvedPath) ?? '') : '';
  });

  output = output.replace(/__MOCHI_SERVER_CSS_URL__(\w+)__/g, (_, name: string) => {
    const resolvedPath = serverIslandPaths.get(name);
    return resolvedPath ? (cssFileUrls.get(resolvedPath) ?? '') : '';
  });

  output = output.replaceAll('__MOCHI_ASSET_PREFIX__', assetPrefix);

  const renderedIslandNames = new Set<string>();
  let hasServerIslands = false;
  new HTMLRewriter()
    .on('mochi-hydratable-island', {
      element(el) {
        const raw = el.getAttribute('component-name');
        if (raw) {
          renderedIslandNames.add(raw);
        }
      },
    })
    .on('mochi-server-island', {
      element() {
        hasServerIslands = true;
      },
    })
    .transform(output);

  const cssUrls: string[] = [];
  for (const componentPath of cssFileUrls.keys()) {
    const cssUrl = cssFileUrls.get(componentPath);
    if (!cssUrl) {
      continue;
    }
    if (lazyIslandPaths.has(componentPath)) {
      continue;
    }
    if (islandPaths.has(componentPath)) {
      const h = hydratables.find((c) => c.resolvedPath === componentPath);
      if (h && !renderedIslandNames.has(h.name)) {
        continue;
      }
    }
    cssUrls.push(cssUrl);
  }

  const shouldStrip = hydratables.length === 0;
  const normalized = normalizeIslandHydrationMarkers(output);
  return shouldStrip ? stripHydrationMarkers(normalized) : normalized;
}

// ---------------------------------------------------------------------------
// NEW approach (after optimization)
// ---------------------------------------------------------------------------

function newPostProcess(body: string): string {
  const hydratablesByName = new Map(hydratables.map((h) => [h.name, h]));
  const hydratablesByPath = new Map(hydratables.map((h) => [h.resolvedPath, h]));
  const islandPaths = new Set(hydratables.map((h) => h.resolvedPath));

  let output = body;
  output = output.replace(/__MOCHI_COMPONENT_URL__(\w+)__/g, (_, name: string) => componentEntryUrls.get(name) ?? '');

  const lazyIslandPaths = new Set<string>();
  output = output.replace(/__MOCHI_CSS_URL__(\w+)__/g, (_, name: string) => {
    const h = hydratablesByName.get(name);
    if (h) {
      lazyIslandPaths.add(h.resolvedPath);
      return cssFileUrls.get(h.resolvedPath) ?? '';
    }
    return '';
  });

  output = output.replace(/__MOCHI_SERVER_CSS_URL__(\w+)__/g, (_, name: string) => {
    const resolvedPath = serverIslandPaths.get(name);
    return resolvedPath ? (cssFileUrls.get(resolvedPath) ?? '') : '';
  });

  output = output.replaceAll('__MOCHI_ASSET_PREFIX__', assetPrefix);

  const shouldStrip = hydratables.length === 0;
  const hasIslandsOrServerIslands = hydratables.length > 0 || output.includes('<mochi-server-island');

  const renderedIslandNames = new Set<string>();
  let hasServerIslands = false;
  if (hasIslandsOrServerIslands || shouldStrip) {
    let islandDepth = 0;
    const trackIsland = {
      element(el: HTMLRewriterTypes.Element) {
        islandDepth++;
        el.onEndTag(() => {
          islandDepth--;
        });
      },
    };
    const rewriter = new HTMLRewriter();
    if (hasIslandsOrServerIslands) {
      rewriter
        .on('mochi-hydratable-island', {
          element(el) {
            islandDepth++;
            el.onEndTag(() => {
              islandDepth--;
            });
            const raw = el.getAttribute('component-name');
            if (raw) {
              renderedIslandNames.add(raw);
            }
          },
        })
        .on('mochi-server-island', {
          element(el) {
            hasServerIslands = true;
            trackIsland.element(el);
          },
        });
    } else if (shouldStrip) {
      rewriter.on('mochi-hydratable-island', trackIsland).on('mochi-server-island', trackIsland);
    }
    if (shouldStrip) {
      rewriter.onDocument({
        comments(comment) {
          if (islandDepth === 0 && isSvelteMarker(comment.text)) {
            comment.remove();
          }
        },
      });
    }
    output = rewriter.transform(output);
  }

  const cssUrls: string[] = [];
  for (const componentPath of cssFileUrls.keys()) {
    const cssUrl = cssFileUrls.get(componentPath);
    if (!cssUrl) {
      continue;
    }
    if (lazyIslandPaths.has(componentPath)) {
      continue;
    }
    if (islandPaths.has(componentPath)) {
      const h = hydratablesByPath.get(componentPath);
      if (h && !renderedIslandNames.has(h.name)) {
        continue;
      }
    }
    cssUrls.push(cssUrl);
  }

  const normalized = normalizeIslandHydrationMarkers(output);
  return normalized;
}

// ---------------------------------------------------------------------------
// SSR-only HTML (no islands — tests the "skip HTMLRewriter" path)
// ---------------------------------------------------------------------------

function buildSsrOnlyHtml(sizeKb: number): string {
  const parts: string[] = ['<!--[--><div class="page"><!--[-->'];
  while (parts.join('').length < sizeKb * 1024) {
    parts.push(`
<!--[--><div class="section">
  <!--[0--><h2>Section heading</h2><!--]-->
  <!--[--><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor.</p><!--]-->
  <!--s8967g--><span class="tag">category</span>
</div><!--]-->
`);
  }
  parts.push('<!--]--></div><!--]-->');
  return parts.join('');
}

// ---------------------------------------------------------------------------
// OLD SSR-only approach (always runs HTMLRewriter + stripHydrationMarkers)
// ---------------------------------------------------------------------------

function oldPostProcessSsrOnly(body: string): string {
  let output = body;

  output = output.replace(/__MOCHI_COMPONENT_URL__(\w+)__/g, (_, name: string) => componentEntryUrls.get(name) ?? '');
  const emptyHydratables: HydratableComponent[] = [];
  const lazyIslandPaths = new Set<string>();

  output = output.replace(/__MOCHI_CSS_URL__(\w+)__/g, () => '');
  output = output.replace(/__MOCHI_SERVER_CSS_URL__(\w+)__/g, () => '');
  output = output.replaceAll('__MOCHI_ASSET_PREFIX__', assetPrefix);

  const renderedIslandNames = new Set<string>();
  let hasServerIslands = false;
  new HTMLRewriter()
    .on('mochi-hydratable-island', {
      element(el) {
        const raw = el.getAttribute('component-name');
        if (raw) {
          renderedIslandNames.add(raw);
        }
      },
    })
    .on('mochi-server-island', {
      element() {
        hasServerIslands = true;
      },
    })
    .transform(output);

  const normalized = normalizeIslandHydrationMarkers(output);
  return stripHydrationMarkers(normalized);
}

// ---------------------------------------------------------------------------
// NEW SSR-only approach (skips HTMLRewriter, strips inline)
// ---------------------------------------------------------------------------

function newPostProcessSsrOnly(body: string): string {
  let output = body;
  output = output.replace(/__MOCHI_COMPONENT_URL__(\w+)__/g, () => '');
  output = output.replace(/__MOCHI_CSS_URL__(\w+)__/g, () => '');
  output = output.replace(/__MOCHI_SERVER_CSS_URL__(\w+)__/g, () => '');
  output = output.replaceAll('__MOCHI_ASSET_PREFIX__', assetPrefix);

  const shouldStrip = true;
  const hasIslandsOrServerIslands = output.includes('<mochi-server-island');

  const renderedIslandNames = new Set<string>();
  let hasServerIslands = false;
  if (hasIslandsOrServerIslands || shouldStrip) {
    let islandDepth = 0;
    const trackIsland = {
      element(el: HTMLRewriterTypes.Element) {
        islandDepth++;
        el.onEndTag(() => {
          islandDepth--;
        });
      },
    };
    const rewriter = new HTMLRewriter();
    if (hasIslandsOrServerIslands) {
      rewriter
        .on('mochi-hydratable-island', {
          element(el) {
            islandDepth++;
            el.onEndTag(() => {
              islandDepth--;
            });
            const raw = el.getAttribute('component-name');
            if (raw) {
              renderedIslandNames.add(raw);
            }
          },
        })
        .on('mochi-server-island', {
          element(el) {
            hasServerIslands = true;
            trackIsland.element(el);
          },
        });
    } else if (shouldStrip) {
      rewriter.on('mochi-hydratable-island', trackIsland).on('mochi-server-island', trackIsland);
    }
    if (shouldStrip) {
      rewriter.onDocument({
        comments(comment) {
          if (islandDepth === 0 && isSvelteMarker(comment.text)) {
            comment.remove();
          }
        },
      });
    }
    output = rewriter.transform(output);
  }

  return normalizeIslandHydrationMarkers(output);
}

// ---------------------------------------------------------------------------
// Large island page (more realistic)
// ---------------------------------------------------------------------------

const LARGE_ISLAND_COUNT = 30;
const largeHydratables: HydratableComponent[] = Array.from({ length: LARGE_ISLAND_COUNT }, (_, i) => ({
  name: `LargeIsland${i}`,
  resolvedPath: `/abs/path/to/LargeIsland${i}.svelte`,
}));
const largeCssFileUrls = new Map(largeHydratables.map((h) => [h.resolvedPath, `/_mochi/client/${h.name}-def456.css`]));
const largeComponentEntryUrls = new Map(largeHydratables.map((h) => [h.name, `/_mochi/client/${h.name}-abc123.js`]));

function buildLargeHtml(): string {
  const parts: string[] = ['<!--[--><div class="page"><!--[-->'];
  for (let i = 0; i < LARGE_ISLAND_COUNT; i++) {
    const isLazy = i % 3 === 0;
    parts.push(`
<!--[--><svelte:boundary><!--[-->
<mochi-hydratable-island island-id="mochi-lg${i}" component-name="LargeIsland${i}"
  component-url="__MOCHI_COMPONENT_URL__LargeIsland${i}__"
  ${isLazy ? `css-url="__MOCHI_CSS_URL__LargeIsland${i}__" hydrate-on="visible"` : ''}
  props-ref="mochi-props-lg-${i}">
  <!--[--><!--[--><div class="island-content-${i}">
    <p>Content for large island ${i} with more text to make the HTML bigger</p>
    <ul><li>Item 1</li><li>Item 2</li><li>Item 3</li></ul>
    <div class="nested"><span>Deep content ${i}</span></div>
  </div><!--]--><!--]-->
</mochi-hydratable-island>
<!--]--></svelte:boundary><!--]-->
`);
  }
  for (const [name] of serverIslandPaths) {
    parts.push(
      `<mochi-server-island island-id="mochi-srv-${name}" component-name="${name}" signed-props="abc" css-url="__MOCHI_SERVER_CSS_URL__${name}__" data-asset-prefix="__MOCHI_ASSET_PREFIX__"></mochi-server-island>`,
    );
  }
  // Pad with non-island HTML
  for (let i = 0; i < 50; i++) {
    parts.push(`<div class="filler-${i}"><p>Static content block ${i}</p></div>`);
  }
  parts.push('<!--]--></div><!--]-->');
  return parts.join('');
}

function oldPostProcessLarge(body: string): string {
  let output = body;
  output = output.replace(/__MOCHI_COMPONENT_URL__(\w+)__/g, (_, name: string) => largeComponentEntryUrls.get(name) ?? '');
  const islandPaths = new Set(largeHydratables.map((h) => h.resolvedPath));
  const lazyIslandPaths = new Set(largeHydratables.filter((h) => output.includes(`__MOCHI_CSS_URL__${h.name}__`)).map((h) => h.resolvedPath));
  output = output.replace(/__MOCHI_CSS_URL__(\w+)__/g, (_, name: string) => {
    const h = largeHydratables.find((c) => c.name === name);
    return h ? (largeCssFileUrls.get(h.resolvedPath) ?? '') : '';
  });
  output = output.replace(/__MOCHI_SERVER_CSS_URL__(\w+)__/g, (_, name: string) => {
    const resolvedPath = serverIslandPaths.get(name);
    return resolvedPath ? (cssFileUrls.get(resolvedPath) ?? '') : '';
  });
  output = output.replaceAll('__MOCHI_ASSET_PREFIX__', assetPrefix);

  const renderedIslandNames = new Set<string>();
  let hasServerIslands = false;
  new HTMLRewriter()
    .on('mochi-hydratable-island', {
      element(el) {
        const r = el.getAttribute('component-name');
        if (r) {
          renderedIslandNames.add(r);
        }
      },
    })
    .on('mochi-server-island', {
      element() {
        hasServerIslands = true;
      },
    })
    .transform(output);

  return normalizeIslandHydrationMarkers(output);
}

function newPostProcessLarge(body: string): string {
  const byName = new Map(largeHydratables.map((h) => [h.name, h]));
  const byPath = new Map(largeHydratables.map((h) => [h.resolvedPath, h]));
  const islandPaths = new Set(largeHydratables.map((h) => h.resolvedPath));

  let output = body;
  output = output.replace(/__MOCHI_COMPONENT_URL__(\w+)__/g, (_, name: string) => largeComponentEntryUrls.get(name) ?? '');

  const lazyIslandPaths = new Set<string>();
  output = output.replace(/__MOCHI_CSS_URL__(\w+)__/g, (_, name: string) => {
    const h = byName.get(name);
    if (h) {
      lazyIslandPaths.add(h.resolvedPath);
      return largeCssFileUrls.get(h.resolvedPath) ?? '';
    }
    return '';
  });

  output = output.replace(/__MOCHI_SERVER_CSS_URL__(\w+)__/g, (_, name: string) => {
    const rp = serverIslandPaths.get(name);
    return rp ? (cssFileUrls.get(rp) ?? '') : '';
  });
  output = output.replaceAll('__MOCHI_ASSET_PREFIX__', assetPrefix);

  const renderedIslandNames = new Set<string>();
  let hasServerIslands = false;
  let islandDepth = 0;
  const trackIsland = {
    element(el: HTMLRewriterTypes.Element) {
      islandDepth++;
      el.onEndTag(() => {
        islandDepth--;
      });
    },
  };
  new HTMLRewriter()
    .on('mochi-hydratable-island', {
      element(el) {
        islandDepth++;
        el.onEndTag(() => {
          islandDepth--;
        });
        const r = el.getAttribute('component-name');
        if (r) {
          renderedIslandNames.add(r);
        }
      },
    })
    .on('mochi-server-island', {
      element(el) {
        hasServerIslands = true;
        trackIsland.element(el);
      },
    })
    .transform(output);

  return normalizeIslandHydrationMarkers(output);
}

const LARGE_HTML = buildLargeHtml();

// ---------------------------------------------------------------------------
// Correctness checks
// ---------------------------------------------------------------------------

function checkCorrectness(label: string, oldFn: (s: string) => string, newFn: (s: string) => string, html: string) {
  const oldResult = oldFn(html);
  const newResult = newFn(html);
  if (oldResult !== newResult) {
    console.error(`MISMATCH in ${label}!`);
    console.error('Old length:', oldResult.length, 'New length:', newResult.length);
    for (let i = 0; i < Math.max(oldResult.length, newResult.length); i++) {
      if (oldResult[i] !== newResult[i]) {
        console.error(`First diff at char ${i}:`);
        console.error('  old:', JSON.stringify(oldResult.slice(Math.max(0, i - 40), i + 40)));
        console.error('  new:', JSON.stringify(newResult.slice(Math.max(0, i - 40), i + 40)));
        break;
      }
    }
    process.exit(1);
  }
  console.log(`  ${label}: PASS`);
}

console.log('Correctness:');
checkCorrectness('small (8 islands)', oldPostProcess, newPostProcess, HTML);
checkCorrectness('large (30 islands)', oldPostProcessLarge, newPostProcessLarge, LARGE_HTML);

const SSR_HTML = buildSsrOnlyHtml(16);
checkCorrectness('ssr-only (16KB)', oldPostProcessSsrOnly, newPostProcessSsrOnly, SSR_HTML);

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------

const WARMUP = 500;
const ITERATIONS = 5000;

function bench(label: string, fn: () => void): { mean: number; p50: number; p95: number; p99: number } {
  for (let i = 0; i < WARMUP; i++) {
    fn();
  }

  const times: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    fn();
    times.push((performance.now() - start) * 1000); // µs
  }
  times.sort((a, b) => a - b);

  const mean = times.reduce((s, t) => s + t, 0) / times.length;
  const p50 = times[Math.floor(times.length * 0.5)]!;
  const p95 = times[Math.floor(times.length * 0.95)]!;
  const p99 = times[Math.floor(times.length * 0.99)]!;

  console.log(`  ${label.padEnd(14)} mean=${mean.toFixed(1)}µs  p50=${p50.toFixed(1)}µs  p95=${p95.toFixed(1)}µs  p99=${p99.toFixed(1)}µs`);
  return { mean, p50, p95, p99 };
}

function runSuite(name: string, htmlSize: number, oldFn: () => void, newFn: () => void) {
  console.log(`\n${name} (${(htmlSize / 1024).toFixed(1)} KB):`);
  const o = bench('OLD', oldFn);
  const n = bench('NEW', newFn);
  const pct = ((o.mean - n.mean) / o.mean) * 100;
  const p50pct = ((o.p50 - n.p50) / o.p50) * 100;
  console.log(`  → ${pct > 0 ? '+' : ''}${pct.toFixed(1)}% mean, ${p50pct > 0 ? '+' : ''}${p50pct.toFixed(1)}% p50`);
}

runSuite(
  'Small page (8 islands + 2 server)',
  HTML.length,
  () => oldPostProcess(HTML),
  () => newPostProcess(HTML),
);

runSuite(
  'Large page (30 islands + 2 server)',
  LARGE_HTML.length,
  () => oldPostProcessLarge(LARGE_HTML),
  () => newPostProcessLarge(LARGE_HTML),
);

runSuite(
  'SSR-only page (no islands, 16KB)',
  SSR_HTML.length,
  () => oldPostProcessSsrOnly(SSR_HTML),
  () => newPostProcessSsrOnly(SSR_HTML),
);
