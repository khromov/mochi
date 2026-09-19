<script lang="ts">
  import Stars from './Stars.svelte';
  import Feed from './Feed.svelte';
  import Boom from './Boom.svelte';
  import Counter from './Counter.svelte';

  const repos = ['alpha', 'bravo', 'charlie'];
</script>

<h1>groups</h1>

{#each repos as repo (repo)}
  <Stars mochi:defer={{ group: 'sidebar', retries: 2 }} {repo}>
    <span class="skeleton">…</span>
  </Stars>
{/each}

<Feed mochi:defer={{ group: 'sidebar' }} items={3}>
  <p>loading feed</p>
</Feed>

<Boom mochi:defer={{ group: 'sidebar' }} />

<Counter mochi:defer={{ group: 'sidebar', name: 'counter' }} mochi:hydrate start={5}>
  <p>loading counter</p>
</Counter>

<Stars mochi:defer={{ group: '' }} repo="ungrouped" />
