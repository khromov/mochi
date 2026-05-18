<script>
  import { fetchItem, fetchUser } from './hn-api.ts';
  import { RECENT_SUBMISSIONS_LIMIT } from './hn-utils.ts';
  import HNStoryRow from './HNStoryRow.svelte';

  let { userId } = $props();

  // svelte-ignore state_referenced_locally
  const user = await fetchUser(userId);
  const recentIds = (user?.submitted ?? []).slice(0, RECENT_SUBMISSIONS_LIMIT);
  const items = (await Promise.all(recentIds.map(fetchItem))).filter((i) => i !== null && !i.deleted);
</script>

{#if items.length === 0}
  <p class="empty">No submissions.</p>
{:else}
  <ol class="story-list">
    {#each items as item, i (item.id)}
      <HNStoryRow {item} rank={i + 1} showAuthor={false} />
    {/each}
  </ol>
{/if}

<style>
  .story-list {
    list-style: none;
    padding: 0;
  }

  .empty {
    color: var(--hn-text-meta);
    font-size: 9pt;
    padding: 8px 0;
  }
</style>
