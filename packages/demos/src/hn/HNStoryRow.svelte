<script>
  import { timeAgo, getDomain, previewText } from './hn-utils.ts';
  import { htmlToText, safeUrl } from './hn-sanitize.ts';

  let { item, rank, showAuthor = true } = $props();

  const title = $derived(item.title ? htmlToText(item.title) : null);
  const fallback = $derived(item.text ? previewText(item.text) : `item ${item.id}`);
  const externalUrl = $derived(safeUrl(item.url));
</script>

<li class="story-item">
  <span class="rank">{rank}.</span>
  <div class="story-main">
    <div class="story-title">
      {#if title}
        {#if externalUrl}
          <a href={externalUrl} class="story-link" rel="nofollow noopener noreferrer">{title}</a>
          <span class="story-domain">({getDomain(externalUrl)})</span>
        {:else}
          <a href="/hn/item/{item.id}/" class="story-link">{title}</a>
        {/if}
      {:else}
        <a href="/hn/item/{item.id}/" class="story-link">{fallback}</a>
      {/if}
    </div>
    <div class="story-meta">
      {#if item.type === 'comment'}
        comment {timeAgo(item.time)} |
        <a href="/hn/item/{item.id}/">link</a>
      {:else if item.type === 'job'}
        {timeAgo(item.time)}
      {:else}
        {item.score ?? 0} points{#if showAuthor}
          by <a href="/hn/user/{encodeURIComponent(item.by ?? '')}/">{item.by ?? 'unknown'}</a>{/if}
        {timeAgo(item.time)} |
        <a href="/hn/item/{item.id}/">{item.descendants ?? 0}&nbsp;comments</a>
      {/if}
    </div>
  </div>
</li>

<style>
  .story-item {
    display: flex;
    align-items: baseline;
    padding: 3px 0;
  }

  .rank {
    color: var(--hn-text-meta);
    min-width: 30px;
    text-align: right;
    margin-right: 6px;
    font-size: 10pt;
  }

  .story-main {
    min-width: 0;
  }

  .story-link {
    color: var(--hn-link);
    text-decoration: none;
    font-size: 10pt;
    overflow-wrap: anywhere;
  }

  .story-link:visited {
    color: var(--hn-link-visited);
  }

  .story-domain {
    color: var(--hn-text-meta);
    font-size: 8pt;
    margin-left: 4px;
    overflow-wrap: anywhere;
  }

  .story-meta {
    color: var(--hn-text-meta);
    font-size: 8pt;
    margin-top: 2px;
  }

  .story-meta a {
    color: var(--hn-text-meta);
    text-decoration: none;
  }

  .story-meta a:hover {
    text-decoration: underline;
  }
</style>
