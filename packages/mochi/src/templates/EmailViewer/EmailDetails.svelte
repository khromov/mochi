<script lang="ts">
  import EmailView from './EmailView.svelte';
  import type { StoredEmail } from './types';

  let { selected }: { selected: StoredEmail | null } = $props();

  const example = `Mochi.email({ to: 'you@app.test', subject: 'Hello', html: '<b>Hi!</b>' })`;

  function fmtDate(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  function fmtSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const metaRows = $derived(
    selected
      ? (
          [
            { label: 'From', value: selected.from },
            { label: 'To', value: selected.to.join(', ') },
            selected.cc?.length ? { label: 'Cc', value: selected.cc.join(', ') } : null,
            selected.bcc?.length ? { label: 'Bcc', value: selected.bcc.join(', ') } : null,
            selected.replyTo ? { label: 'Reply-To', value: selected.replyTo } : null,
            { label: 'Date', value: fmtDate(selected.sentAt) },
          ] as Array<{ label: string; value: string } | null>
        ).filter((r): r is { label: string; value: string } => r !== null)
      : [],
  );

  const headerEntries = $derived(selected?.headers ? Object.entries(selected.headers) : []);
</script>

<main class="detail-pane">
  {#if !selected}
    <div class="detail-empty">
      <div class="empty-mark">✉️</div>
      <h2>No mail captured yet</h2>
      <p>Messages sent through the <code>dev</code> transport land here. Send one from your app:</p>
      <pre class="empty-code"><code>{example}</code></pre>
    </div>
  {:else}
    <div class="detail-head">
      <h1 class="detail-subject">{selected.subject || '(no subject)'}</h1>
      <dl class="meta-grid">
        {#each metaRows as row (row.label)}
          <div class="meta-item">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        {/each}
      </dl>

      {#if headerEntries.length > 0}
        <details class="headers">
          <summary>Custom headers ({headerEntries.length})</summary>
          <dl class="header-list">
            {#each headerEntries as [k, v] (k)}
              <div class="header-item">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            {/each}
          </dl>
        </details>
      {/if}
    </div>

    {#if selected.attachments && selected.attachments.length > 0}
      <div class="attachments">
        {#each selected.attachments as a (a.filename)}
          <span class="attach-chip">
            <span class="attach-name">{a.filename}</span>
            <span class="attach-size">{fmtSize(a.size)}</span>
          </span>
        {/each}
      </div>
    {/if}

    <EmailView mochi:hydrate html={selected.html} text={selected.text} />
  {/if}
</main>

<style>
  .detail-pane {
    background: var(--ev-surface);
    border: 1px solid var(--ev-border);
    border-radius: var(--ev-radius-lg);
    box-shadow: var(--ev-shadow-md);
    padding: 1.5rem;
    min-width: 0;
  }

  .detail-empty {
    text-align: center;
    padding: 3rem 1.5rem;
    color: var(--ev-text-muted);
  }
  .empty-mark {
    font-size: 2.5rem;
  }
  .detail-empty h2 {
    font-family: var(--ev-font-serif);
    font-weight: 500;
    font-size: 1.25rem;
    color: var(--ev-text);
    margin: 0.75rem 0 0.4rem;
  }
  .detail-empty p {
    font-size: 0.9rem;
    margin: 0 auto 1rem;
    max-width: 26rem;
  }
  .detail-empty code {
    font-family: var(--ev-font-mono);
    background: var(--ev-surface-muted);
    padding: 0.05rem 0.3rem;
    border-radius: 4px;
    font-size: 0.85em;
  }
  .empty-code {
    display: inline-block;
    text-align: left;
    margin: 0;
    padding: 0.75rem 1rem;
    background: var(--ev-surface-muted);
    border: 1px solid var(--ev-border);
    border-radius: var(--ev-radius-md);
    font-family: var(--ev-font-mono);
    font-size: 0.78rem;
    color: var(--ev-text-muted);
    overflow-x: auto;
    max-width: 100%;
  }

  .detail-head {
    margin-bottom: 1.25rem;
  }
  .detail-subject {
    font-family: var(--ev-font-serif);
    font-weight: 500;
    font-size: 1.5rem;
    letter-spacing: -0.01em;
    color: var(--ev-text);
    margin: 0 0 1rem;
    word-break: break-word;
  }
  .meta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.5rem;
    margin: 0;
  }
  .meta-item {
    background: var(--ev-surface-muted);
    border: 1px solid var(--ev-border);
    border-radius: var(--ev-radius-md);
    padding: 0.5rem 0.75rem;
    min-width: 0;
  }
  .meta-item dt {
    font-size: 0.65rem;
    color: var(--ev-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 700;
  }
  .meta-item dd {
    margin: 0.15rem 0 0;
    font-size: 0.9rem;
    color: var(--ev-text);
    font-weight: 500;
    word-break: break-word;
  }

  .headers {
    margin-top: 0.75rem;
    font-size: 0.82rem;
  }
  .headers summary {
    cursor: pointer;
    color: var(--ev-text-muted);
    font-weight: 600;
  }
  .header-list {
    margin: 0.5rem 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .header-item {
    display: flex;
    gap: 0.6rem;
    font-family: var(--ev-font-mono);
    font-size: 0.76rem;
  }
  .header-item dt {
    color: var(--ev-text-subtle);
    min-width: 8rem;
    flex-shrink: 0;
  }
  .header-item dd {
    margin: 0;
    color: var(--ev-text);
    word-break: break-all;
  }

  .attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1.1rem;
  }
  .attach-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 0.4rem;
    padding: 0.3rem 0.65rem;
    background: var(--ev-surface-muted);
    border: 1px solid var(--ev-border);
    border-radius: 999px;
    font-size: 0.78rem;
  }
  .attach-name {
    font-weight: 600;
    color: var(--ev-text);
  }
  .attach-size {
    color: var(--ev-text-subtle);
    font-family: var(--ev-font-mono);
    font-size: 0.7rem;
  }
</style>
