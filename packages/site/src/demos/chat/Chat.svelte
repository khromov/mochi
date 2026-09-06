<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import ChatWidget from './ChatWidget.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Real-time Chat"
  description="An example of building a simple in-memory chat using a hydrated island and the built-in WebSocket support in Bun. The server stores a bounded message history and replays it to new connections; ws.publish() broadcasts each message to all clients. Frames over 4 KB are dropped by Bun before they are buffered, and a per-address window closes any client sending more than 20 messages per 10 seconds. Open this page in two tabs to see them sync in real time."
  {sources}
>
  <ChatWidget mochi:hydrate />
</DemoPage>
