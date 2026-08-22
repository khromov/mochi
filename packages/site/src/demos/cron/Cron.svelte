<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import CronLog from './CronLog.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Scheduled jobs with cron"
  description="A Mochi.cron() job appends one entry to an in-memory log every minute. The browser subscribes over a WebSocket and shows each new row the moment it lands."
  {sources}
>
  <CronLog mochi:hydrate />
</DemoPage>
