<script lang="ts">
  import EmailView from './EmailView.svelte';
  import TimeAgo from './TimeAgo.svelte';

  interface StoredAttachment {
    filename: string;
    contentType?: string;
    size: number;
  }
  interface StoredEmail {
    id: string;
    sentAt: number;
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    replyTo?: string;
    subject: string;
    html?: string;
    text?: string;
    headers?: Record<string, string>;
    attachments?: StoredAttachment[];
  }
  interface EmailListItem {
    id: string;
    sentAt: number;
    from: string;
    to: string[];
    subject: string;
    hasHtml: boolean;
    hasText: boolean;
    attachmentCount: number;
  }

  let { emails, selected, basePath }: { emails: EmailListItem[]; selected: StoredEmail | null; basePath: string } = $props();

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

<svelte:head>
  <title>Mochi · Dev outbox</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<div class="shell">
  <header class="topbar">
    <div class="brand">
      <span class="mark">🍡</span>
      <span class="wordmark">mochi <em>outbox</em></span>
      <span class="dev-pill">dev</span>
    </div>
    <div class="topbar-actions">
      <span class="count">{emails.length} captured</span>
      {#if emails.length > 0}
        <form method="POST" action="?/clear" class="clear-form">
          <button type="submit" name="clear" class="clear-btn">Clear</button>
        </form>
      {/if}
    </div>
  </header>

  <div class="split">
    <aside class="list-pane">
      {#if emails.length === 0}
        <div class="list-empty">Empty</div>
      {:else}
        <ul class="msg-list">
          {#each emails as e (e.id)}
            <li>
              <a class="msg" class:active={selected?.id === e.id} href="{basePath}?id={e.id}">
                <div class="msg-row">
                  <span class="msg-subject">{e.subject || '(no subject)'}</span>
                  <span class="msg-time"><TimeAgo sentAt={e.sentAt} mochi:hydrate /></span>
                </div>
                <div class="msg-to">{e.to.join(', ')}</div>
                {#if (!e.hasHtml && e.hasText) || e.attachmentCount > 0}
                  <div class="msg-tags">
                    {#if !e.hasHtml && e.hasText}<span class="tag">text</span>{/if}
                    {#if e.attachmentCount > 0}<span class="tag">📎 {e.attachmentCount}</span>{/if}
                  </div>
                {/if}
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </aside>

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

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 0.4rem 0.2rem 1rem;
    border-bottom: 1px solid var(--ev-border);
    margin-bottom: 1.25rem;
  }
  .brand {
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .mark {
    font-size: 1.35rem;
    line-height: 1;
  }
  .wordmark {
    font-family: var(--ev-font-serif);
    font-size: 1.25rem;
    font-weight: 500;
    color: var(--ev-text);
    letter-spacing: -0.01em;
  }
  .wordmark em {
    font-style: normal;
    color: var(--ev-accent);
  }
  .dev-pill {
    align-self: center;
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--ev-accent-soft-text);
    background: var(--ev-accent-soft);
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
  }
  .topbar-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.85rem;
  }
  .count {
    font-size: 0.78rem;
    color: var(--ev-text-subtle);
    font-family: var(--ev-font-mono);
    font-variant-numeric: tabular-nums;
  }
  .clear-form {
    margin: 0;
  }
  .clear-btn {
    appearance: none;
    font-family: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--ev-text-muted);
    background: var(--ev-surface);
    border: 1px solid var(--ev-border-strong);
    border-radius: var(--ev-radius-sm);
    padding: 0.35rem 0.8rem;
    cursor: pointer;
    transition:
      color 0.14s ease,
      border-color 0.14s ease,
      background 0.14s ease;
  }
  .clear-btn:hover {
    color: #7a2e20;
    border-color: #d8a99e;
    background: #f7e7e1;
  }

  .split {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 1.25rem;
    align-items: start;
  }

  .list-pane {
    background: var(--ev-surface);
    border: 1px solid var(--ev-border);
    border-radius: var(--ev-radius-lg);
    box-shadow: var(--ev-shadow-sm);
    overflow: hidden;
    position: sticky;
    top: 1rem;
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
  }
  .list-empty {
    padding: 2rem 1rem;
    text-align: center;
    color: var(--ev-text-subtle);
    font-style: italic;
    font-size: 0.85rem;
  }
  .msg-list {
    list-style: none;
    margin: 0;
    padding: 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .msg {
    display: block;
    text-decoration: none;
    color: inherit;
    padding: 0.6rem 0.7rem;
    border-radius: var(--ev-radius-md);
    border-left: 2px solid transparent;
    transition:
      background 0.12s ease,
      border-color 0.12s ease;
  }
  .msg:hover {
    background: var(--ev-accent-soft);
    border-left-color: var(--ev-accent);
  }
  .msg.active {
    background: var(--ev-accent-soft);
    border-left-color: var(--ev-accent);
  }
  .msg-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .msg-subject {
    font-weight: 600;
    font-size: 0.88rem;
    color: var(--ev-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .msg.active .msg-subject {
    color: var(--ev-accent-soft-text);
  }
  .msg-time {
    flex-shrink: 0;
    font-size: 0.68rem;
    color: var(--ev-text-subtle);
    font-family: var(--ev-font-mono);
  }
  .msg-to {
    margin-top: 0.15rem;
    font-size: 0.76rem;
    color: var(--ev-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .msg-tags {
    display: flex;
    gap: 0.3rem;
    margin-top: 0.35rem;
  }
  .tag {
    font-size: 0.62rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    background: var(--ev-surface-muted);
    color: var(--ev-text-subtle);
    border: 1px solid var(--ev-border);
  }

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

  @media (max-width: 760px) {
    .split {
      grid-template-columns: 1fr;
    }
    .list-pane {
      position: static;
      max-height: 340px;
    }
  }
</style>
