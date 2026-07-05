<script lang="ts">
  import { getRequestContext } from 'mochi-framework';

  // Reading the request context at render time must throw — email always
  // renders isolated from any ambient request, even inside requestContext.run.
  const { url } = getRequestContext();
</script>

<p>{url.pathname}</p>
