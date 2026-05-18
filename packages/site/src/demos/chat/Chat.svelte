<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import ChatWidget from './ChatWidget.svelte';
  import { loadSources } from '../../components/utils.ts';

  const sources = await loadSources([
    { label: 'Chat.svelte', path: './src/demos/chat/Chat.svelte' },
    { label: 'ChatWidget.svelte', path: './src/demos/chat/ChatWidget.svelte' },
    { label: 'routes.ts', path: './src/demos/chat/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
</script>

<DemoPage
  title="Real-time Chat"
  description="An example of building a simple in-memory chat using a hydrated island and the built-in WebSocket support in Bun. The server stores message history and replays it to new connections; ws.publish() broadcasts each message to all clients. Open this page in two tabs to see them sync in real time."
  {sources}
>
  <ChatWidget mochi:hydrate />
</DemoPage>
