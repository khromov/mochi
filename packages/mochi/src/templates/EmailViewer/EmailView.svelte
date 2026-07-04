<script lang="ts">
  type Tab = 'html' | 'text' | 'source';

  let { html, text }: { html?: string; text?: string } = $props();

  const tabs = $derived(
    (
      [html ? { id: 'html', label: 'Preview' } : null, text ? { id: 'text', label: 'Text' } : null, html ? { id: 'source', label: 'Source' } : null] as Array<{
        id: Tab;
        label: string;
      } | null>
    ).filter((t): t is { id: Tab; label: string } => t !== null),
  );

  let active: Tab = $state(html ? 'html' : 'text');

  let frame = $state<HTMLIFrameElement | null>(null);
  let frameHeight = $state(480);

  // srcdoc + sandbox="allow-same-origin" (no allow-scripts) isolates the email:
  // its own <script>s never run, but the parent can still read the document to
  // size the frame to its content.
  function sizeFrame() {
    const doc = frame?.contentDocument;
    if (!doc) {
      return;
    }
    const h = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
    if (h > 0) {
      frameHeight = Math.min(Math.max(h, 160), 2400);
    }
  }
</script>

<div class="viewer">
  <div class="tabbar" role="tablist">
    {#each tabs as t (t.id)}
      <button type="button" role="tab" class="tab" class:active={active === t.id} aria-selected={active === t.id} onclick={() => (active = t.id)}>
        {t.label}
      </button>
    {/each}
  </div>

  <div class="pane">
    {#if active === 'html' && html}
      <iframe bind:this={frame} class="frame" title="Email preview" sandbox="allow-same-origin" srcdoc={html} style="height: {frameHeight}px" onload={sizeFrame}></iframe>
    {:else if active === 'text' && text}
      <pre class="text-body">{text}</pre>
    {:else if active === 'source' && html}
      <pre class="source"><code>{html}</code></pre>
    {:else}
      <div class="pane-empty">No {active} body</div>
    {/if}
  </div>
</div>

<style>
  .viewer {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .tabbar {
    display: inline-flex;
    gap: 0.25rem;
    padding: 0.25rem;
    background: var(--ev-surface-muted);
    border: 1px solid var(--ev-border);
    border-radius: 999px;
    align-self: flex-start;
    margin-bottom: 0.9rem;
  }
  .tab {
    appearance: none;
    border: none;
    background: transparent;
    color: var(--ev-text-muted);
    font-family: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 0.32rem 0.85rem;
    border-radius: 999px;
    cursor: pointer;
    transition:
      background 0.14s ease,
      color 0.14s ease;
  }
  .tab:hover {
    color: var(--ev-text);
  }
  .tab.active {
    background: var(--ev-accent);
    color: var(--ev-accent-text);
    box-shadow: var(--ev-shadow-sm);
  }

  .pane {
    min-width: 0;
  }
  .frame {
    width: 100%;
    border: 1px solid var(--ev-border);
    border-radius: var(--ev-radius-md);
    background: #fff;
    display: block;
    box-shadow: var(--ev-shadow-sm);
  }
  .text-body,
  .source {
    margin: 0;
    padding: 1rem 1.15rem;
    border: 1px solid var(--ev-border);
    border-radius: var(--ev-radius-md);
    background: var(--ev-surface-muted);
    color: var(--ev-text);
    font-family: var(--ev-font-mono);
    font-size: 0.8rem;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-x: auto;
    max-height: 70vh;
  }
  .source {
    color: var(--ev-text-muted);
  }
  .source code {
    font-family: inherit;
  }
  .pane-empty {
    padding: 2rem;
    text-align: center;
    color: var(--ev-text-subtle);
    font-style: italic;
    border: 1px dashed var(--ev-border-strong);
    border-radius: var(--ev-radius-md);
  }
</style>
