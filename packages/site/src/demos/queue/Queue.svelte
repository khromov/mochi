<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import QueueWidget from './QueueWidget.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';
  import type { QueueStatus } from './types.ts';

  const sources = await loadSources(files);

  let { initial, suggestedUser }: { initial: QueueStatus; suggestedUser: string } = $props();
</script>

<DemoPage
  title="Background jobs with chains"
  description="Mochi.jobs() declares a typed job-type registry with one processor per type, mounted via the Mochi.serve() jobs option. The form starts a two-step chain — send-notification continues into record-receipt — and the result streams back live."
  {sources}
>
  <p>
    The page action calls <code>jobs.startChain({'{'} typeName: 'send-notification', input: {'{ user }'} })</code>. The worker — with
    <code>concurrency: 2</code> — runs the handler, which <code>continueWith</code>s into <code>record-receipt</code> to record the delivery. Initial state comes from
    <code>serverProps</code>; a <code>Mochi.sse()</code> route then pushes each completion in realtime — no polling.
  </p>
  <QueueWidget {initial} {suggestedUser} mochi:hydrate />
</DemoPage>

<style>
  p {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  code {
    background: var(--code-bg);
    color: var(--code-accent);
    padding: 0.05rem 0.35rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }
</style>
