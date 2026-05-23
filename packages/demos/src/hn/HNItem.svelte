<script>
  import { params } from 'mochi-framework';
  import { fetchItem } from './hn-api.ts';
  import { sanitizeHtml, htmlToText, safeUrl } from './hn-sanitize.ts';
  import { timeAgo, getDomain, COMMENT_INITIAL_COUNT } from './hn-utils.ts';
  import HNComments from './HNComments.svelte';
  import HNLayout from './HNLayout.svelte';
  import HNSkeletonLine from './HNSkeletonLine.svelte';

  const item = await fetchItem(Number(params.id));
  const title = item?.title ? htmlToText(item.title) : null;
  const externalUrl = item ? safeUrl(item.url) : null;
  const kids = item?.kids ?? [];
  const initialKids = kids.slice(0, COMMENT_INITIAL_COUNT);
  const remainingKids = kids.slice(COMMENT_INITIAL_COUNT);
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<HNLayout metaTags={{ title: `${title ?? 'Item'} | HN Clone` }}>
  {#if item}
    <div class="item-header">
      <div class="item-title">
        {#if externalUrl}
          <a href={externalUrl} class="title-link" rel="nofollow noopener noreferrer">{title}</a>
          <span class="domain">({getDomain(externalUrl)})</span>
        {:else}
          <span class="title-link">{title}</span>
        {/if}
      </div>
      <div class="item-meta">
        {item.score ?? 0} points by
        <a href="/hn/user/{encodeURIComponent(item.by ?? '')}/">{item.by ?? 'unknown'}</a>
        {timeAgo(item.time)} | {item.descendants ?? 0} comments
      </div>
      {#if item.text}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized -->
        <div class="item-text">{@html sanitizeHtml(item.text)}</div>
      {/if}
    </div>

    <HNComments mochi:defer kids={initialKids}>
      <div class="comments-skeleton" aria-busy="true" aria-label="Loading comments">
        {#each Array(20) as _, i (i)}
          <div class="skeleton-comment" style="margin-left: {Math.min(i, 3) * 20}px">
            <HNSkeletonLine width="30%" height="8px" />
            <HNSkeletonLine width="95%" />
            <HNSkeletonLine width="60%" />
          </div>
        {/each}
      </div>
    </HNComments>

    {#if remainingKids.length > 0}
      <HNComments mochi:defer:visible={{ rootMargin: '200px' }} kids={remainingKids}>
        <div class="comments-skeleton" aria-busy="true" aria-label="Loading more comments">
          {#each Array(3) as _, i (i)}
            <div class="skeleton-comment">
              <HNSkeletonLine width="30%" height="8px" />
              <HNSkeletonLine width="95%" />
              <HNSkeletonLine width="60%" />
            </div>
          {/each}
        </div>
      </HNComments>
    {/if}
  {:else}
    <p class="not-found">Item not found.</p>
  {/if}
</HNLayout>

<style>
  .item-header {
    margin-bottom: 16px;
  }

  .title-link {
    color: var(--hn-link);
    text-decoration: none;
    font-size: 10pt;
    overflow-wrap: anywhere;
  }

  .domain {
    color: var(--hn-text-meta);
    font-size: 8pt;
    margin-left: 4px;
    overflow-wrap: anywhere;
  }

  .item-meta {
    color: var(--hn-text-meta);
    font-size: 8pt;
    margin-top: 4px;
  }

  .item-meta a {
    color: var(--hn-text-meta);
    text-decoration: none;
  }

  .item-meta a:hover {
    text-decoration: underline;
  }

  .item-text {
    color: var(--hn-text);
    font-size: 9pt;
    margin-top: 10px;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .item-text :global(a) {
    color: var(--hn-link);
  }

  .comments-skeleton {
    margin-top: 16px;
  }

  .skeleton-comment {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .not-found {
    color: var(--hn-text-meta);
    padding: 20px 0;
  }
</style>
