<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import ChatWidget from './ChatWidget.svelte';
  import { compiled } from 'mochi-framework';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await compiled(() => loadSources(files));
</script>

<DemoPage
  title="Real-time Chat"
  description="An example of building a simple in-memory chat using a hydrated island and the built-in WebSocket support in Bun. The server stores message history and replays it to new connections; ws.publish() broadcasts each message to all clients. Open this page in two tabs to see them sync in real time."
  {sources}
>
  <ChatWidget mochi:hydrate />
</DemoPage>
