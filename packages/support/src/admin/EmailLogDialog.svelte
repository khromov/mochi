<script lang="ts">
  import type { EmailLogEntry, EmailStatus } from '../types';

  let { status, entries }: { status: EmailStatus; entries: EmailLogEntry[] } = $props();

  let dialog = $state<HTMLDialogElement | null>(null);

  const label = $derived(status === 'sent' ? 'email sent' : status === 'failed' ? 'email failed' : 'email pending');
  const stamp = (at: number) => new Date(at).toISOString().replace('T', ' ').slice(0, 19);
</script>

<button type="button" class="pill {status}" onclick={() => dialog?.showModal()} title="Show delivery log">
  {label}
</button>

<dialog bind:this={dialog} onclick={(e) => e.target === dialog && dialog?.close()}>
  <h3>Delivery log</h3>
  {#if entries.length === 0}
    <p class="empty">No delivery attempts recorded.</p>
  {:else}
    <ol>
      {#each entries as entry (entry.id)}
        <li>
          <span class="event {entry.event}">{entry.event}</span>
          <time datetime={new Date(entry.at).toISOString()}>{stamp(entry.at)}</time>
          {#if entry.attempt > 0}
            <span class="attempt">attempt {entry.attempt}</span>
          {/if}
          {#if entry.detail}
            <p class="detail">{entry.detail}</p>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
  <button type="button" class="close" onclick={() => dialog?.close()}>Close</button>
</dialog>

<style>
  .pill {
    font: inherit;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text-subtle);
    cursor: pointer;
  }

  .pill:hover {
    filter: brightness(0.96);
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

  dialog {
    /* The shell's `* { margin: 0 }` reset kills the UA's `margin: auto`, which is
       what centers a modal dialog — without this it renders in the top-left. */
    margin: auto;
    max-width: 32rem;
    width: calc(100vw - 2rem);
    padding: 1.25rem 1.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
  }

  dialog::backdrop {
    background: rgba(31, 42, 36, 0.45);
  }

  h3 {
    font-family: var(--font-serif);
    font-size: 1.25rem;
    font-weight: 500;
    margin-bottom: 0.75rem;
  }

  ol {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-bottom: 1rem;
  }

  li {
    border-left: 2px solid var(--border);
    padding-left: 0.75rem;
    font-size: 0.9rem;
  }

  .event {
    font-weight: 600;
    margin-right: 0.5rem;
  }

  .event.sent {
    color: var(--accent-soft-text);
  }

  .event.failed {
    color: var(--badge-danger-text);
  }

  time,
  .attempt {
    color: var(--text-subtle);
    font-size: 0.8rem;
  }

  .attempt::before {
    content: '· ';
  }

  .detail {
    color: var(--text-muted);
    word-break: break-word;
  }

  .empty {
    color: var(--text-subtle);
    margin-bottom: 1rem;
  }

  .close {
    font: inherit;
    font-size: 0.9rem;
    font-weight: 500;
    padding: 0.4rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .close:hover {
    background: var(--surface-muted);
    color: var(--text);
  }
</style>
