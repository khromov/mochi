<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import QueueWidget from './QueueWidget.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Background jobs with queues"
  description="Mochi.queue() is a producer handle; Mochi.worker() runs a consumer in the same process. The form enqueues a job, the worker processes it ~700ms later, and the status endpoint reflects the result."
  {sources}
>
  <p>
    The page action calls <code>emailQueue.add('send', {'{ to }'})</code>. A
    <code>Mochi.worker('demo-emails', …)</code> with <code>concurrency: 2</code> picks the job up and records it. The widget polls
    <code>/demos/queue/status</code> to show processed jobs as they land.
  </p>
  <QueueWidget mochi:hydrate />
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
