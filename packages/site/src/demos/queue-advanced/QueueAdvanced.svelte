<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import QueueAdvancedWidget from './QueueAdvancedWidget.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';
  import type { QueueAdvancedStatus } from './types.ts';

  const sources = await loadSources(files);

  let { initial }: { initial: QueueAdvancedStatus } = $props();
</script>

<DemoPage
  title="Advanced queue patterns"
  description="Three queues on one shared store exercise retries with exponential backoff, a dead-letter queue with redrive, throttled and debounced adds, deferred jobs, and priority ordering — with every internal transition streamed into the live log."
  {sources}
>
  <p>
    <code>demo-webhooks</code> declares <code>retryLimit: 2</code>, <code>retryDelay: 2</code>, <code>retryBackoff: true</code> and
    <code>deadLetter: 'demo-webhooks-dlq'</code>: a flaky job recovers on its second attempt, a doomed one exhausts all three and moves to the DLQ, where
    <code>Mochi.boss().redrive()</code>
    sends it back. Throttle and debounce resolve <code>null</code> when a slot is taken. The storage backend is picked at boot with
    <code>QUEUE_STORAGE=memory|sqlite|postgres</code> — with a durable backend, queued jobs survive a server restart.
  </p>
  <QueueAdvancedWidget {initial} mochi:hydrate />
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
