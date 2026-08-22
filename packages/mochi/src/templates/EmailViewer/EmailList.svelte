<script lang="ts">
  import MsgItem from './MsgItem.svelte';
  import type { EmailListItem } from './types';

  let { emails, selectedId, basePath }: { emails: EmailListItem[]; selectedId: string | null; basePath: string } = $props();
</script>

<aside class="list-pane">
  {#if emails.length === 0}
    <div class="list-empty">Empty</div>
  {:else}
    <ul class="msg-list">
      {#each emails as e (e.id)}
        <li>
          <MsgItem
            id={e.id}
            subject={e.subject}
            to={e.to}
            sentAt={e.sentAt}
            hasHtml={e.hasHtml}
            hasText={e.hasText}
            attachmentCount={e.attachmentCount}
            active={selectedId === e.id}
            {basePath}
            mochi:hydrate
          />
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
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

  @media (max-width: 760px) {
    .list-pane {
      position: static;
      max-height: 340px;
    }
  }
</style>
