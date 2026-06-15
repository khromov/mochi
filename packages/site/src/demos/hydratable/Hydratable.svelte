<script lang="ts">
  import { hydratable } from 'svelte';
  import { Database } from 'bun:sqlite';
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';
  import FactCard from './FactCard.svelte';
  import FactCardProps from './FactCardProps.svelte';

  const sources = await loadSources(files);

  // Top-level await runs server-side. With hydratable, the result is serialized
  // into <head>; the matching call inside the hydrated island below reads it
  // back from window.__svelte.h instead of re-running this function on the client.
  const fact = await hydratable('mochi-demo:fact', () => {
    console.log('[server] computing fact via bun:sqlite (should print once per request)');
    const db = new Database(':memory:');
    const row = db.query("SELECT datetime('now') as now, sqlite_version() as version").get() as { now: string; version: string };
    db.close();
    return {
      sqliteVersion: row.version,
      computedAt: row.now,
    };
  });
</script>

<DemoPage
  title="Hydratable"
  description="hydratable() runs once on the server; the hydrated island reads the same value from <head> on the client without re-running the async work. Watch the server console — the 'computing fact' line prints once per request, never on hydration."
  {sources}
>
  <h3>Page (SSR-only)</h3>
  <p class="hint">Runs in the page's top-level script and is inlined into the rendered HTML.</p>
  <p class="row">SQLite <strong>{fact.sqliteVersion}</strong>, server time <code>{fact.computedAt}</code></p>

  <h3>Island using hydratable()</h3>
  <p class="hint">Reads the SSR value out of window.__svelte.h on the client without re-running the work.</p>
  <FactCard mochi:hydrate />

  <h3>Island using a prop</h3>
  <p class="hint">Receives the value as a prop; Mochi serialises it into the island's HTML.</p>
  <FactCardProps {fact} mochi:hydrate />
</DemoPage>

<style>
  h3 {
    margin: 1rem 0 0.25rem;
    font-size: 1rem;
    font-weight: 600;
  }
  .hint {
    color: var(--text-muted);
    font-size: 0.85em;
    margin: 0 0 0.5rem;
  }
  .row {
    margin: 0 0 0.5rem;
  }
  code {
    font-size: 0.9em;
  }
</style>
