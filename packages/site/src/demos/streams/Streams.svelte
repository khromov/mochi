<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import RealtimeClocks from './RealtimeClocks.svelte';
  import { loadSources } from '../../components/utils.ts';

  const sources = await loadSources([
    { label: 'Streams.svelte', path: './src/demos/streams/Streams.svelte' },
    { label: 'RealtimeClocks.svelte', path: './src/demos/streams/RealtimeClocks.svelte' },
    { label: 'routes.ts', path: './src/demos/streams/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
</script>

<DemoPage
  title="Real-time Streams"
  description="You can build a WebSocket clock and a Server-Sent Events clock side by side, ticking every second. The component hydrates only when scrolled into view via mochi:hydrate:visible with a 100px rootMargin."
  {sources}
>
  <RealtimeClocks mochi:hydrate />
</DemoPage>
