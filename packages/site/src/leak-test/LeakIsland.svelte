<script>
  import { cookies } from 'mochi-framework';

  let { name = 'World', bigProp = '' } = $props();

  const username = cookies.get('mochi_username');
  // svelte-ignore state_referenced_locally
  const displayName = username ?? name;
  const renderedAt = Date.now();
</script>

<div>
  <p>Hello, {displayName}</p>
  <p>Rendered at {renderedAt}</p>
  <p>bigProp length: {bigProp.length}</p>
</div>
