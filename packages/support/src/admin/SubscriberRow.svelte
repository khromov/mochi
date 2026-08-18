<script lang="ts">
  import EmailLogDialog from './EmailLogDialog.svelte';
  import type { NewsletterLogEntry, Subscriber } from '../db.server';

  let { subscriber, log }: { subscriber: Subscriber; log: NewsletterLogEntry[] } = $props();

  const stamp = (at: number) => new Date(at).toISOString().replace('T', ' ').slice(0, 16);
  const since = $derived(subscriber.confirmed_at ?? subscriber.unsubscribed_at ?? subscriber.created_at);
</script>

<article class="row {subscriber.status}">
  <div class="who">
    <a href="mailto:{subscriber.email}">{subscriber.email}</a>
    <span class="status {subscriber.status}">{subscriber.status}</span>
    {#if subscriber.source}
      <span class="source">via {subscriber.source}</span>
    {/if}
  </div>

  <div class="meta">
    <EmailLogDialog mochi:hydrate status={subscriber.email_status} entries={log} />
    <time datetime={new Date(since).toISOString()}>{stamp(since)}</time>
  </div>

  {#if subscriber.email_error}
    <p class="error">{subscriber.email_error}</p>
  {/if}

  <div class="actions">
    {#if subscriber.status === 'pending'}
      <form method="post" action="?/resendConfirmation">
        <input type="hidden" name="id" value={subscriber.id} />
        <button type="submit">Resend confirmation</button>
      </form>
    {/if}
    {#if subscriber.status !== 'unsubscribed'}
      <form method="post" action="?/unsubscribeSignup">
        <input type="hidden" name="id" value={subscriber.id} />
        <button type="submit" class="secondary">Unsubscribe</button>
      </form>
    {/if}
    <!-- Two-step rather than a JS confirm(): this row is plain SSR markup, not an
         island, so no handler of ours would be wired up client-side. -->
    <details class="danger">
      <summary>Delete</summary>
      <form method="post" action="?/deleteSignup">
        <input type="hidden" name="id" value={subscriber.id} />
        <span>Permanently remove {subscriber.email}?</span>
        <button type="submit" class="secondary">Confirm delete</button>
      </form>
    </details>
  </div>
</article>

<style>
  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.4rem 1rem;
    align-items: baseline;
    padding: 0.85rem 1.25rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }

  .row.unsubscribed {
    background: var(--surface-muted);
    opacity: 0.75;
  }

  .who {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
  }

  .who a {
    font-weight: 600;
    color: var(--accent-hover);
    text-underline-offset: 3px;
  }

  .status {
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: var(--surface-muted);
    color: var(--text-subtle);
    border: 1px solid var(--border);
  }

  .status.confirmed {
    background: var(--accent-soft);
    color: var(--accent-soft-text);
    border-color: transparent;
  }

  .source {
    font-size: 0.8rem;
    color: var(--text-subtle);
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.85rem;
    color: var(--text-subtle);
  }

  .error {
    grid-column: 1 / -1;
    margin: 0;
    font-size: 0.85rem;
    color: var(--badge-danger-text);
  }

  .actions {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  button {
    font: inherit;
    font-size: 0.85rem;
    font-weight: 500;
    padding: 0.3rem 0.75rem;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: var(--accent-text);
    cursor: pointer;
  }

  button:hover {
    background: var(--accent-hover);
  }

  button.secondary {
    background: transparent;
    border-color: var(--border);
    color: var(--text-muted);
  }

  button.secondary:hover {
    background: var(--surface-muted);
    color: var(--text);
  }

  .danger summary {
    display: inline-block;
    padding: 0.3rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--text-muted);
    cursor: pointer;
    list-style: none;
  }

  .danger summary::-webkit-details-marker {
    display: none;
  }

  .danger summary:hover {
    background: var(--surface-muted);
    color: var(--text);
  }

  .danger form {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
    font-size: 0.85rem;
    color: var(--text-muted);
  }
</style>
