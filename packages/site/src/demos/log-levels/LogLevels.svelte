<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import Pinger from './Pinger.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Console Log Levels"
  description="The consoleLogger:level filter remaps the severity of any console line. Here /demos/log-levels/loud is promoted to warn and /demos/log-levels/quiet is demoted to debug, while every other route keeps the level the framework chose."
  {sources}
>
  <p class="note">
    This one only shows up in the terminal running the server, so you need to clone the site and run it locally — there is nothing to see on the hosted mochi.fast. With
    <code>bun run dev:site</code>
    going, fire a request below and watch the log.
  </p>

  <Pinger mochi:hydrate />

  <p class="hint">
    <code>loud</code>
    prints as a yellow warn line — it would still print in production, where the level defaults to
    <code>warn</code>. <code>quiet</code>
    prints nothing at all, because <code>debug</code>
    sits below the development default of <code>info</code>; start the server with
    <code>logger: &lbrace; level: 'debug' &rbrace;</code>
    and it reappears. Demoting is not dropping — for that, return
    <code>null</code>
    from <code>consoleLogger:line</code>.
  </p>
</DemoPage>

<style>
  .note,
  .hint {
    font-size: 0.9rem;
    color: var(--text-muted);
    margin: 0 0 1rem;
  }

  .hint {
    margin: 1rem 0 0;
  }

  code {
    font-family: var(--font-mono);
    font-size: 0.85em;
  }
</style>
