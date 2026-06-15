<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import ThrowOnSsr from './ThrowOnSsr.svelte';
  import ThrowOnClient from './ThrowOnClient.svelte';
  import ThrowOnServerIsland from './ThrowOnServerIsland.svelte';
  import HealthyServerIsland from './HealthyServerIsland.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

{#snippet caughtFallback(error: unknown)}
  <div class="caught">
    Caught by user-written boundary:
    <code>{error instanceof Error ? error.message : String(error)}</code>
  </div>
{/snippet}

<DemoPage
  title="Error Boundaries"
  description="You can use Svelte error boundaries to isolate failures. Without them, any one throwing component could take down a whole page load (which might be what you want sometimes). With boundaries, the failure is walled off and the rest of the page keeps working. In dev, the failed island shows a small dashed-red marker; in prod, it disappears silently."
  {sources}
>
  <section class="mode">
    <header>
      <h2>1. Non-hydrated component + user <code>&lt;svelte:boundary&gt;</code></h2>
      <p>
        Non-hydrated components don't get an automatic boundary. If they can throw during SSR, wrap them in a hand-written <code>&lt;svelte:boundary&gt;</code> — otherwise the throw
        bubbles up and crashes the whole request.
      </p>
    </header>
    <svelte:boundary failed={caughtFallback}><ThrowOnSsr label="ThrowOnSsr (no directive)" /></svelte:boundary>
  </section>

  <section class="mode">
    <header>
      <h2>2. <code>mochi:hydrate</code> — SSR throw (recovery)</h2>
      <p>
        The framework auto-wraps every <code>mochi:hydrate</code> island in a boundary. This island throws on the server only — the boundary catches the SSR throw and the rest of the
        page renders unaffected.
      </p>
    </header>
    <ThrowOnSsr mochi:hydrate label="ThrowOnSsr" />
  </section>

  <section class="mode">
    <header>
      <h2>3. <code>mochi:hydrate</code> — client throw</h2>
      <p>
        SSR is fine, but the script throws synchronously once the island tries to hydrate. The defensive try/catch around <code>hydrate()</code> catches it and swaps the island for the
        failure stub — the rest of the page (already rendered on the server) is untouched.
      </p>
    </header>
    <ThrowOnClient mochi:hydrate label="ThrowOnClient" />
  </section>

  <section class="mode">
    <header>
      <h2>4. <code>mochi:defer</code> — server island throw</h2>
      <p>
        Server islands render at a separate endpoint. When that render throws, the endpoint returns a 200 with an error stub — the browser doesn't waste retries on a deterministic
        failure. The user-supplied loading children stay until the response arrives.
      </p>
    </header>
    <ThrowOnServerIsland mochi:defer label="ThrowOnServerIsland">
      <div class="placeholder">Loading from server…</div>
    </ThrowOnServerIsland>
  </section>

  <section class="mode">
    <header>
      <h2>
        5. <code>mochi:defer</code> — healthy island, inner <code>mochi:hydrate</code> client throw
      </h2>
      <p>
        The server island itself renders successfully — it's the inner <code>mochi:hydrate</code>
        child that throws once it tries to hydrate on the client. The child's auto-boundary catches its own failure, so the rest of the server island content stays intact.
      </p>
    </header>
    <HealthyServerIsland mochi:defer>
      <div class="placeholder">Loading from server…</div>
    </HealthyServerIsland>
  </section>
</DemoPage>

<style>
  .mode {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 2.5rem;
  }

  .mode header {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .mode h2 {
    margin: 0;
    font-family: var(--font-serif);
    font-size: 1.35rem;
    font-weight: 500;
  }

  .mode h2 code,
  .mode p code {
    font-family: var(--font-mono);
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.85em;
    font-weight: 500;
  }

  .mode p {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1.5;
  }

  .placeholder {
    padding: 1rem;
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius-md);
    color: var(--text-subtle);
    text-align: center;
    font-size: 0.9rem;
  }

  .caught {
    padding: 0.75rem 1rem;
    border: 2px dashed var(--badge-warning-text, #c80);
    background: var(--badge-warning-bg, #fff7e6);
    color: var(--badge-warning-text, #8a4d00);
    border-radius: var(--radius-md);
    font-size: 0.9rem;
  }

  .caught code {
    font-family: var(--font-mono);
    font-size: 0.85em;
  }
</style>
