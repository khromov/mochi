<script>
  import { fetchCommentTree } from './hn-api.ts';
  import { sanitizeHtml } from './hn-sanitize.ts';
  import { timeAgo, COMMENT_MAX_DEPTH, COMMENT_MAX_INDENT, COMMENT_INDENT_PX } from './hn-utils.ts';

  let { kids = [] } = $props();

  // svelte-ignore state_referenced_locally
  const comments = kids.length ? await fetchCommentTree(kids, COMMENT_MAX_DEPTH) : [];
</script>

<div class="comments-section">
  {#snippet renderComment(comment, depth)}
    <details class="comment" open style="margin-left: {Math.min(depth, COMMENT_MAX_INDENT) * COMMENT_INDENT_PX}px">
      <summary class="comment-header">
        <a href="/hn/user/{encodeURIComponent(comment.by ?? '')}/" class="comment-author">{comment.by ?? 'unknown'}</a>
        <span class="comment-time">{timeAgo(comment.time)}</span>
      </summary>
      <div class="comment-body">
        {#if comment.text}
          <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized -->
          <div class="comment-text">{@html sanitizeHtml(comment.text)}</div>
        {/if}
        {#if comment.children && comment.children.length > 0}
          {#each comment.children as child (child.id)}
            {@render renderComment(child, depth + 1)}
          {/each}
        {:else if comment.kids && comment.kids.length > 0}
          <a href="/hn/item/{comment.id}/" class="load-more">
            [{comment.kids.length} more {comment.kids.length === 1 ? 'reply' : 'replies'}]
          </a>
        {/if}
      </div>
    </details>
  {/snippet}

  {#if comments.length === 0}
    <p class="no-comments">No comments yet.</p>
  {:else}
    {#each comments as comment (comment.id)}
      {@render renderComment(comment, 0)}
    {/each}
  {/if}
</div>

<style>
  .comments-section {
    margin-top: 16px;
  }

  .comment {
    margin-top: 8px;
    border-left: none;
  }

  .comment > summary {
    list-style: none;
    cursor: pointer;
    font-size: 8pt;
    color: var(--hn-text-meta);
    user-select: none;
  }

  .comment > summary::-webkit-details-marker {
    display: none;
  }

  .comment > summary::before {
    content: '[\2013]';
    margin-right: 4px;
    font-family: monospace;
  }

  .comment:not([open]) > summary::before {
    content: '[+]';
  }

  .comment-author {
    color: var(--hn-text-meta);
    text-decoration: none;
    font-weight: bold;
  }

  .comment-author:hover {
    text-decoration: underline;
  }

  .comment-time {
    color: var(--hn-text-meta);
  }

  .comment-body {
    margin-top: 4px;
  }

  .comment-text {
    color: var(--hn-text);
    font-size: 9pt;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .comment-text :global(a) {
    color: var(--hn-link);
  }

  .comment-text :global(p) {
    margin-top: 8px;
  }

  .load-more {
    color: var(--hn-text-meta);
    text-decoration: none;
    font-size: 8pt;
    margin-top: 4px;
    display: inline-block;
  }

  .load-more:hover {
    text-decoration: underline;
  }

  .no-comments {
    color: var(--hn-text-meta);
    font-size: 9pt;
    padding: 8px 0;
  }
</style>
