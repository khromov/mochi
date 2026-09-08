<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import CronLog from './CronLog.svelte';
  import { sources } from './sources.compiled.ts';
</script>

<DemoPage
  title="Scheduled jobs with cron"
  description="A Mochi.cron() job appends one entry to an in-memory log every minute. The browser subscribes over a WebSocket and shows each new row the moment it lands."
  {sources}
>
  <CronLog mochi:hydrate />
</DemoPage>
