<script lang="ts">
  import EmailDetails from './EmailDetails.svelte';
  import EmailList from './EmailList.svelte';
  import Header from './Header.svelte';
  import OutboxSync from './OutboxSync.svelte';
  import type { EmailListItem, StoredEmail } from './types';

  let { emails, selected, basePath }: { emails: EmailListItem[]; selected: StoredEmail | null; basePath: string } = $props();
</script>

<svelte:head>
  <title>Mochi · Dev outbox</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<OutboxSync viewedId={selected?.id ?? null} allIds={emails.map((e) => e.id)} mochi:hydrate />

<div class="shell">
  <Header count={emails.length} />

  <div class="split">
    <EmailList {emails} selectedId={selected?.id ?? null} {basePath} />
    <EmailDetails {selected} {basePath} />
  </div>
</div>

<style>
  :global(:root) {
    --ev-bg: #f5f3ec;
    --ev-surface: #fffdf8;
    --ev-surface-muted: #faf8f1;
    --ev-border: #e8e4d8;
    --ev-border-strong: #c9cfc5;
    --ev-text: #1f2a24;
    --ev-text-muted: #4a5751;
    --ev-text-subtle: #6e756d;
    --ev-accent: #4a7c59;
    --ev-accent-hover: #3d6b4a;
    --ev-accent-text: #fff;
    --ev-accent-soft: #e0ebe1;
    --ev-accent-soft-text: #2f5b3f;
    --ev-shadow-sm: 0 1px 3px rgba(47, 61, 51, 0.05);
    --ev-shadow-md: 0 4px 16px rgba(47, 61, 51, 0.06), 0 1px 3px rgba(47, 61, 51, 0.04);
    --ev-radius-sm: 6px;
    --ev-radius-md: 8px;
    --ev-radius-lg: 16px;
    --ev-font-sans: 'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --ev-font-serif: 'Fraunces Variable', Fraunces, Georgia, 'Times New Roman', serif;
    --ev-font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) {
      --ev-bg: #171914;
      --ev-surface: #1f221c;
      --ev-surface-muted: #1a1d17;
      --ev-border: #2e3228;
      --ev-border-strong: #434836;
      --ev-text: #e8e6dd;
      --ev-text-muted: #a8ada0;
      --ev-text-subtle: #8e9488;
      --ev-accent: #8ab79a;
      --ev-accent-hover: #a2cfb1;
      --ev-accent-text: #1a1d17;
      --ev-accent-soft: #2a3a2f;
      --ev-accent-soft-text: #c7e0cd;
      --ev-shadow-sm: inset 0 0 0 1px rgba(255, 253, 240, 0.02);
      --ev-shadow-md: inset 0 0 0 1px rgba(255, 253, 240, 0.03), 0 1px 2px rgba(0, 0, 0, 0.3);
    }
  }
  :global(:root[data-theme='dark']) {
    --ev-bg: #171914;
    --ev-surface: #1f221c;
    --ev-surface-muted: #1a1d17;
    --ev-border: #2e3228;
    --ev-border-strong: #434836;
    --ev-text: #e8e6dd;
    --ev-text-muted: #a8ada0;
    --ev-text-subtle: #8e9488;
    --ev-accent: #8ab79a;
    --ev-accent-hover: #a2cfb1;
    --ev-accent-text: #1a1d17;
    --ev-accent-soft: #2a3a2f;
    --ev-accent-soft-text: #c7e0cd;
    --ev-shadow-sm: inset 0 0 0 1px rgba(255, 253, 240, 0.02);
    --ev-shadow-md: inset 0 0 0 1px rgba(255, 253, 240, 0.03), 0 1px 2px rgba(0, 0, 0, 0.3);
  }

  :global(html, body) {
    margin: 0;
  }
  :global(body) {
    background: var(--ev-bg);
    color: var(--ev-text);
    font-family: var(--ev-font-sans);
    line-height: 1.55;
    color-scheme: light dark;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }

  .shell {
    max-width: 1180px;
    margin: 0 auto;
    padding: 1.25rem 1.25rem 3rem;
  }

  .split {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 1.25rem;
    align-items: start;
  }

  @media (max-width: 760px) {
    .split {
      grid-template-columns: 1fr;
    }
  }
</style>
