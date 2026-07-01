<script lang="ts">
  import { getRequestContext } from 'mochi-framework';
  import LikeButton from './LikeButton.svelte';
  import Visitor from './Visitor.svelte';

  let { siteName, renderedAt }: { siteName: string; renderedAt: string } = $props();

  const { url } = getRequestContext();
  const visitorName = url.searchParams.get('name') ?? 'friend';
</script>

<h1>Welcome to {siteName}</h1>
<p>Rendered at <code>{renderedAt}</code></p>

<LikeButton mochi:hydrate initialLikes={42} />

<Visitor mochi:defer name={visitorName}>
  <p>Loading…</p>
</Visitor>
