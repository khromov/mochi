<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import TaskWidget from './TaskWidget.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';
  import type { TaskStatus } from './types.ts';

  const sources = await loadSources(files);

  let { initial }: { initial: TaskStatus } = $props();
</script>

<DemoPage
  title="Scheduled tasks"
  description="A Mochi.task() runs work on a cron schedule, declared once in the Mochi.serve() tasks option. This one ticks every five seconds; each run is pushed to the browser as it happens."
  {sources}
>
  <p>
    The task is declared as <code>tasks: {'{'} 'demo-heartbeat': … }</code> in <code>Mochi.serve()</code> with a
    <code>'*/5 * * * * *'</code> pattern. Initial state comes from <code>serverProps</code>; a
    <code>Mochi.sse()</code> route subscribed to the <code>task:run</code> event then pushes each tick live. The countdown
    reads <code>Mochi.getTask('demo-heartbeat').nextRun()</code>.
  </p>
  <p>
    Run this app on several nodes and the schedule still fires once: each node contends for a lease, and only the winner
    runs <code>'cluster'</code>-scoped tasks.
  </p>
  <TaskWidget {initial} mochi:hydrate />
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
