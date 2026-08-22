<script lang="ts">
  import type { Snippet } from 'svelte';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Info from '@lucide/svelte/icons/info';
  import OctagonX from '@lucide/svelte/icons/octagon-x';
  import Lightbulb from '@lucide/svelte/icons/lightbulb';

  type CalloutType = 'info' | 'warning' | 'danger' | 'tip';

  let { type = 'warning', children }: { type?: CalloutType; children: Snippet } = $props();

  const Icon = $derived(type === 'tip' ? Lightbulb : type === 'info' ? Info : type === 'danger' ? OctagonX : TriangleAlert);
</script>

<aside class="callout callout-{type}" role="note">
  <Icon class="callout-icon" size={18} aria-hidden="true" />
  <div class="callout-body">{@render children()}</div>
</aside>

<style>
  .callout {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.6rem;
    align-items: start;
    margin: 1.5rem 0 0.75rem;
    padding: 0.6rem 0.9rem;
    border-left: 3px solid;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    color: var(--text);
  }

  .callout :global(.callout-icon) {
    margin-top: 0.35rem;
    flex-shrink: 0;
  }

  .callout-body :global(p) {
    margin: 0 0 0.4rem;
    color: inherit;
  }

  .callout-body :global(p:last-child) {
    margin-bottom: 0;
  }

  /* Inline code only — `:not(pre) > code` excludes fenced code blocks, whose
     `pre` already carries the dark `--code-bg`; tinting their `<code>` here
     would paint a grey overlay on top of it. */
  .callout-body :global(:not(pre) > code) {
    background: rgb(0 0 0 / 0.06);
    padding: 0.05rem 0.3rem;
    border-radius: 4px;
    font-size: 0.92em;
  }

  /* Mirror the dark tint into both dark paths: the `prefers-color-scheme`
     (auto) media query and the explicit `data-theme='dark'` opt-in. */
  @media (prefers-color-scheme: dark) {
    :global(html:not([data-theme='light'])) .callout-body :global(:not(pre) > code) {
      background: rgb(255 255 255 / 0.08);
    }
  }

  :global(html[data-theme='dark']) .callout-body :global(:not(pre) > code) {
    background: rgb(255 255 255 / 0.08);
  }

  .callout-warning {
    background: color-mix(in srgb, var(--badge-warning-bg) 45%, var(--surface));
    border-left-color: var(--badge-warning-text);
  }
  .callout-warning :global(.callout-icon) {
    color: var(--badge-warning-text);
    margin-top: 0.38rem;
  }

  .callout-info {
    background: color-mix(in srgb, var(--badge-info-bg) 45%, var(--surface));
    border-left-color: var(--badge-info-text);
  }
  .callout-info :global(.callout-icon) {
    color: var(--badge-info-text);
  }

  .callout-danger {
    background: color-mix(in srgb, var(--badge-danger-bg) 45%, var(--surface));
    border-left-color: var(--badge-danger-text);
  }
  .callout-danger :global(.callout-icon) {
    color: var(--badge-danger-text);
  }

  .callout-tip {
    background: color-mix(in srgb, var(--badge-tip-bg) 45%, var(--surface));
    border-left-color: var(--badge-tip-text);
  }
  .callout-tip :global(.callout-icon) {
    color: var(--badge-tip-text);
  }
</style>
