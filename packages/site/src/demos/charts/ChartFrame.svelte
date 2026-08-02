<script lang="ts">
  import type { Snippet } from 'svelte';
  let { height = 240, children }: { height?: number; children: Snippet } = $props();
</script>

<div class="chart-frame" style="--frame-h: {height}px">
  {@render children()}
</div>

<style>
  .chart-frame {
    min-height: calc(var(--frame-h) + 1.5rem);
    width: 100%;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    overflow-x: auto;

    --chart-1: #4a7c59;
    --chart-2: #b07d4a;
    --chart-3: #4a6f8c;
    --chart-4: #8a7ea8;
  }

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

  .chart-frame :global(.lc-root-container) {
    position: relative;

    --color-primary: var(--chart-1);
    --color-surface-100: var(--surface);
    --color-surface-200: var(--surface-muted);
    --color-surface-300: var(--border);
    --color-surface-content: var(--text);

    font-family: var(--font-sans);
    font-size: 0.78rem;
  }

  .chart-frame :global(.lc-root-container button) {
    font: inherit;
    color: inherit;
    background: none;
    border: 0;
    cursor: pointer;
  }
</style>
