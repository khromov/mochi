<script lang="ts">
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- svelte-eslint-parser treats <Script> as the HTML script element, not this component, so it can't see the markup usage
  import { Script } from 'mochi-framework/components';
</script>

<h1>script-multi-fixture</h1>
<Script scripts={['./snippet.ts', './other.ts']} />
