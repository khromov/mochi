<script lang="ts">
  import type { Snippet } from 'svelte';

  // `height` doubles as the CSS reservation and the value handed to the chart, so the
  // server-rendered frame and the hydrated one agree and nothing jumps vertically.
  let { height = 240, children }: { height?: number; children: Snippet } = $props();
</script>

<div class="chart-frame" style="--frame-h: {height}px">
  {@render children()}
</div>

<style>
  .chart-frame {
    /* Reserve the chart's own height plus this box's padding, so a frame that is still empty
       before its island hydrates doesn't grow the page when the chart appears. */
    min-height: calc(var(--frame-h) + 1.5rem);
    width: 100%;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    overflow-x: auto;

    /* Three tints of the site's one accent green would be indistinguishable in a stack, so
       the categorical ramp is its own set, each colour picked to hold contrast on both the
       cream and the dark-olive surface. */
    --chart-1: #4a7c59;
    --chart-2: #b07d4a;
    --chart-3: #4a6f8c;
    --chart-4: #8a7ea8;
  }

  /* Mirrors shell.html's two-pronged dark strategy — media query for "no explicit choice",
     attribute selector for "user opted in" — or the theme toggle desyncs from the charts. */
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .chart-frame {
      --chart-1: #8ab79a;
      --chart-2: #d0a06a;
      --chart-3: #8aacc8;
      --chart-4: #b3a6d1;
    }
  }

  :global(:root[data-theme='dark']) .chart-frame {
    --chart-1: #8ab79a;
    --chart-2: #d0a06a;
    --chart-3: #8aacc8;
    --chart-4: #b3a6d1;
  }

  /* LayerChart generates `.lc-root-container` itself, so this has to be :global() — Svelte
     would otherwise scope-hash a class that never appears in our markup and prune the rule
     as unused. Keeping the (hashed) `.chart-frame` prefix stops the mapping leaking sitewide. */
  .chart-frame :global(.lc-root-container) {
    /* LayerChart sets this itself via `style:position`, but Svelte's server compiler emits
       that shorthand as the derived-prop accessor rather than its value, so a server-rendered
       chart lands on `position: static` and its absolutely-positioned SVG layer escapes to
       the page origin. Harmless once hydrated; needed for the non-hydrated chart. */
    position: relative;

    --color-primary: var(--chart-1);
    --color-surface-100: var(--surface);
    --color-surface-200: var(--surface-muted);
    --color-surface-300: var(--border);
    --color-surface-content: var(--text);

    font-family: var(--font-sans);
    font-size: 0.78rem;
  }

  /* LayerChart renders its interactive legend entries as <button>s but leaves them to inherit
     the page's button reset, which it assumes a CSS framework's preflight provides. This site
     has none, so without this they show up as grey UA-styled boxes with unreadable labels. */
  .chart-frame :global(.lc-root-container button) {
    font: inherit;
    color: inherit;
    background: none;
    border: 0;
    cursor: pointer;
  }
</style>
