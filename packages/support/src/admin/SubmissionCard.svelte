<script lang="ts">
  import type { Submission } from '../types';

  let { submission }: { submission: Submission } = $props();

  const handled = $derived(submission.handled_at !== null);
  const submitted = $derived(new Date(submission.created_at).toISOString().replace('T', ' ').slice(0, 16));
</script>

<article class="card" class:handled>
  <header>
    <div class="who">
      <span class="name">{submission.name || 'Anonymous'}</span>
      <a href="mailto:{submission.email}">{submission.email}</a>
    </div>
    <div class="meta">
      <span class="pill {submission.email_status}">
        {#if submission.email_status === 'sent'}
          email sent
        {:else if submission.email_status === 'failed'}
          email failed
        {:else}
          email pending
        {/if}
      </span>
      <time datetime={new Date(submission.created_at).toISOString()}>{submitted}</time>
    </div>
  </header>

  <p class="message">{submission.message}</p>

  {#if submission.email_error}
    <p class="error">{submission.email_error}</p>
  {/if}

  <form method="post" action={handled ? '?/unhandle' : '?/handle'}>
    <input type="hidden" name="id" value={submission.id} />
    <button type="submit" class:secondary={handled}>{handled ? 'Mark unhandled' : 'Mark handled'}</button>
  </form>
</article>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.25rem 1.5rem;
    box-shadow: var(--shadow-md);
  }

  .card.handled {
    background: var(--surface-muted);
    box-shadow: none;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.75rem;
  }

  .name {
    font-weight: 600;
    margin-right: 0.5rem;
  }

  .who a {
    color: var(--accent-hover);
    text-underline-offset: 3px;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.85rem;
    color: var(--text-subtle);
  }

  .pill {
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text-subtle);
  }

  .pill.sent {
    background: var(--accent-soft);
    color: var(--accent-soft-text);
    border-color: transparent;
  }

  .pill.failed {
    background: #f7e2dd;
    color: var(--badge-danger-text);
    border-color: transparent;
  }

  .message {
    white-space: pre-wrap;
    color: var(--text-muted);
    margin-bottom: 0.75rem;
  }

  .error {
    font-size: 0.85rem;
    color: var(--badge-danger-text);
    margin-bottom: 0.75rem;
  }

  button {
    font: inherit;
    font-size: 0.9rem;
    font-weight: 500;
    padding: 0.4rem 0.9rem;
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
    background: var(--surface);
    color: var(--text);
  }
</style>
