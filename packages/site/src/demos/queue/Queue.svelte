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
  title="Background jobs with queues"
  description="A Mochi.queue(name) bundles a job channel with its process() consumer, declared once in the Mochi.serve() queues array. The form enqueues a job, the queue processes it ~700ms later, and the result streams back live."
  {sources}
>
  <p>
    The page action calls the bounded <code>enqueueNotification({'{ user }'})</code> admission helper, which adds to the descriptor returned by
    <code>Mochi.queue('demo-notifications', …)</code>
    only while fewer than 100 jobs are pending. Its <code>process</code> function — with
    <code>concurrency: 2</code>, mounted via <code>queues: [notificationQueue]</code> in
    <code>Mochi.serve()</code> — picks the job up and records it. Initial state comes from
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
