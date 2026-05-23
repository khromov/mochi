<script>
  import { params } from 'mochi-framework';
  import { fetchUser } from './hn-api.ts';
  import { sanitizeHtml } from './hn-sanitize.ts';
  import { formatDate } from './hn-utils.ts';
  import HNRecentSubmissions from './HNRecentSubmissions.svelte';
  import HNLayout from './HNLayout.svelte';
  import HNSkeletonLine from './HNSkeletonLine.svelte';

  const user = await fetchUser(params.id);
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<HNLayout metaTags={{ title: `${params.id} | HN Clone` }}>
  {#if user}
    <div class="user-profile">
      <h1 class="user-name">{user.id}</h1>
      <table class="user-details">
        <tbody>
          <tr>
            <td class="label">created:</td>
            <td>{formatDate(user.created)}</td>
          </tr>
          <tr>
            <td class="label">karma:</td>
            <td>{user.karma.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>

      {#if user.about}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized -->
        <div class="user-about">{@html sanitizeHtml(user.about)}</div>
      {/if}

      <h2 class="section-title">Recent Submissions</h2>
      <HNRecentSubmissions mochi:defer userId={user.id}>
        <ul class="submissions-skeleton" aria-busy="true" aria-label="Loading submissions">
          {#each Array(8) as _, i (i)}
            <li class="skeleton-row">
              <span class="skeleton-rank">
                <HNSkeletonLine />
              </span>
              <span class="skeleton-main">
                <HNSkeletonLine width="70%" />
                <HNSkeletonLine width="35%" height="8px" />
              </span>
            </li>
          {/each}
        </ul>
      </HNRecentSubmissions>
    </div>
  {:else}
    <p class="not-found">User not found.</p>
  {/if}
</HNLayout>

<style>
  .user-profile {
    padding: 10px 0;
  }

  .user-name {
    color: var(--hn-text);
    font-size: 14pt;
    font-weight: bold;
    margin-bottom: 8px;
  }

  .user-details {
    color: var(--hn-text);
    font-size: 9pt;
    margin-bottom: 12px;
    border-collapse: collapse;
  }

  .user-details td {
    padding: 2px 8px 2px 0;
  }

  .user-details .label {
    color: var(--hn-text-meta);
  }

  .user-about {
    color: var(--hn-text);
    font-size: 9pt;
    line-height: 1.4;
    margin-bottom: 16px;
    padding: 8px 0;
    border-top: 1px solid var(--hn-border);
    overflow-wrap: anywhere;
  }

  .user-about :global(a) {
    color: var(--hn-link);
  }

  .section-title {
    color: var(--hn-text);
    font-size: 10pt;
    font-weight: bold;
    margin-bottom: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--hn-border);
  }

  .submissions-skeleton {
    list-style: none;
    padding: 0;
  }

  .skeleton-row {
    display: flex;
    align-items: baseline;
    padding: 3px 0;
    gap: 6px;
  }

  .skeleton-rank {
    display: block;
    width: 18px;
  }

  .skeleton-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .not-found {
    color: var(--hn-text-meta);
    padding: 20px 0;
  }
</style>
