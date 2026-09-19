<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import RepoStars from './RepoStars.svelte';
  import IslandRequests from './IslandRequests.svelte';
  import { sources } from './sources.prerender.ts';

  const grouped = ['sveltejs/svelte', 'oven-sh/bun', 'vercel/next.js', 'withastro/astro', 'vitejs/vite', 'honojs/hono', 'drizzle-team/drizzle-orm', 'colinhacks/zod'];
  const ungrouped = ['tailwindlabs/tailwindcss', 'remix-run/remix', 'solidjs/solid'];
</script>

<DemoPage
  title="Grouped Server Islands"
  description="Give several mochi:defer islands the same group name and Mochi fetches all of them in one request instead of one per island. The eight badges below share group: 'stars' and arrive together; the three under them are plain mochi:defer and each cost their own round trip. Props stay encrypted either way — the whole group is sealed into a single token."
  {sources}
>
  <IslandRequests mochi:hydrate />

  <h2>Eight islands, one request</h2>
  <ul class="repos">
    {#each grouped as repo (repo)}
      <li>
        <code>{repo}</code>
        <RepoStars mochi:defer={{ group: 'stars' }} {repo}>
          <span class="skeleton"></span>
        </RepoStars>
      </li>
    {/each}
  </ul>

  <h2>Three islands, three requests</h2>
  <ul class="repos">
    {#each ungrouped as repo (repo)}
      <li>
        <code>{repo}</code>
        <RepoStars mochi:defer {repo}>
          <span class="skeleton"></span>
        </RepoStars>
      </li>
    {/each}
  </ul>
</DemoPage>

<style>
  h2 {
    margin: 1.5rem 0 0.5rem;
    font-size: 1rem;
  }

  .repos {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.4rem;
  }

  .repos li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .repos code {
    font-size: 0.9rem;
  }

  .skeleton {
    display: inline-block;
    width: 5.5rem;
    height: 1.55rem;
    border-radius: var(--radius-sm);
    background: var(--surface-muted);
  }
</style>
