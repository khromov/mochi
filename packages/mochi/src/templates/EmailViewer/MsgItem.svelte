<script lang="ts">
  import { onMount } from 'svelte';
  import TimeAgo from './TimeAgo.svelte';
  import { UNREAD_EMAILS_KEY, loadUnreadEmailIds } from '../../debug-bar/unread';

  let {
    id,
    subject,
    to,
    sentAt,
    hasHtml,
    hasText,
    attachmentCount,
    active,
    basePath,
  }: {
    id: string;
    subject: string;
    to: string[];
    sentAt: number;
    hasHtml: boolean;
    hasText: boolean;
    attachmentCount: number;
    active: boolean;
    basePath: string;
  } = $props();

  // Read/unread comes from the debug bar's localStorage set. The active message is
  // the one being viewed, so it always counts as read. Computed after hydration (in
  // onMount) rather than at the top level so SSR (no localStorage) and the first
  // client render agree — the styling then settles in as a post-hydration update.
  let unread = $state(false);

  onMount(() => {
    const sync = () => {
      unread = !active && loadUnreadEmailIds().includes(id);
    };
    sync();
    const onStorage = (e: StorageEvent) => {
      if (e.key === UNREAD_EMAILS_KEY) {
        sync();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  });
</script>

<a class="msg" class:active class:unread href="{basePath}?id={id}">
  <div class="msg-row">
    <span class="msg-subject">
      {#if unread}<span class="unread-dot" aria-hidden="true"></span>{/if}
      {subject || '(no subject)'}
    </span>
    <span class="msg-time"><TimeAgo {sentAt} /></span>
  </div>
  <div class="msg-to">{to.join(', ')}</div>
  {#if (!hasHtml && hasText) || attachmentCount > 0}
    <div class="msg-tags">
      {#if !hasHtml && hasText}<span class="tag">text</span>{/if}
      {#if attachmentCount > 0}<span class="tag">📎 {attachmentCount}</span>{/if}
    </div>
  {/if}
</a>

<style>
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
    font-weight: 500;
    font-size: 0.88rem;
    color: var(--ev-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .msg.active .msg-subject {
    color: var(--ev-accent-soft-text);
  }
  /* Unread: full-strength colour, heavier weight, and a leading accent dot. */
  .msg.unread .msg-subject {
    font-weight: 700;
    color: var(--ev-text);
  }
  .unread-dot {
    display: inline-block;
    width: 0.5rem;
    height: 0.5rem;
    margin-right: 0.15rem;
    border-radius: 50%;
    background: var(--ev-accent);
    vertical-align: middle;
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
</style>
