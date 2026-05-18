<script>
  import { url } from 'mochi-framework';
  import { fetchStories } from './hn-api.ts';
  import HNStoryRow from './HNStoryRow.svelte';
  import HNLayout from './HNLayout.svelte';
  import { PAGE_SIZE, STORY_TYPES } from './hn-utils.ts';

  const { type = 'topstories' } = $props();
  const page = Math.max(0, Math.floor(Number(url.searchParams.get('p') ?? 0) || 0));
  // svelte-ignore state_referenced_locally
  const { items, total } = await fetchStories(type, page, PAGE_SIZE);
  // svelte-ignore state_referenced_locally
  const meta = STORY_TYPES[type] ?? STORY_TYPES.topstories;
</script>

<svelte:head>
  <title>{meta.label} | HN Clone</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<HNLayout activeNav={type}>
  <ol class="story-list" start={page * PAGE_SIZE + 1}>
    {#each items as item, i (item.id)}
      <HNStoryRow {item} rank={page * PAGE_SIZE + i + 1} />
    {/each}
  </ol>

  {#if (page + 1) * PAGE_SIZE < total}
    <a href="/hn/{meta.path}/?p={page + 1}" class="more-link">More</a>
  {/if}
</HNLayout>

<style>
  .story-list {
    list-style: none;
    padding: 0;
  }

  .more-link {
    display: inline-block;
    margin: 10px 0 10px 36px;
    color: var(--hn-link);
    font-size: 10pt;
  }
</style>
