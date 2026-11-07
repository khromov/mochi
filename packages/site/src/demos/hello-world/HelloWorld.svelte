<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import { sources } from './sources.prerender.ts';
</script>

<DemoPage title="Hello World" description="The simplest possible Mochi page — a Svelte component rendered on the server with no client-side JavaScript." {sources}>
  <p>Hello, world!</p>
</DemoPage>
