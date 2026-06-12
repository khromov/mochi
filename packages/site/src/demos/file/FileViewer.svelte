<script lang="ts">
  import { isBrowser } from 'mochi-framework';

  let path = $state('/demos/file/download');
  let body = $state('');
  let meta = $state('');
  let loading = $state(false);

  const routes = [
    { label: 'String path', path: '/demos/file/download' },
    { label: 'Resolver · sample', path: '/demos/file/dynamic/sample' },
    { label: 'Resolver · notes', path: '/demos/file/dynamic/notes' },
    { label: 'Resolver · missing (404)', path: '/demos/file/dynamic/nope' },
  ];

  async function load(target: string) {
    if (!isBrowser) {
      return;
    }
    path = target;
    loading = true;
    body = '';
    meta = '';
    try {
      const res = await fetch(target);
      meta = `${res.status} · ${res.headers.get('content-type') ?? 'no content-type'} · ${res.headers.get('content-length') ?? '?'} bytes`;
      body = await res.text();
    } catch (e: unknown) {
      meta = 'error';
      body = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }
</script>

<div class="viewer">
  <div class="routes">
    {#each routes as r (r.path)}
      <button class="route-btn" class:active={path === r.path} onclick={() => load(r.path)}>
        {r.label}
        <code>{r.path}</code>
      </button>
    {/each}
  </div>

  <div class="output">
    <div class="meta">{loading ? 'Loading…' : meta || 'Pick a route to fetch the file.'}</div>
    {#if body}
      <pre>{body}</pre>
    {/if}
  </div>

  <a class="download" href="/demos/file/download" download>Download sample.txt ↓</a>
</div>

<style>
  .viewer {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .routes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  @media (max-width: 480px) {
    .routes {
      grid-template-columns: 1fr;
    }
  }

  .route-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    text-align: left;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    color: var(--text);
    cursor: pointer;
    font-weight: 600;
    font-size: 0.85rem;
  }

  .route-btn.active {
    border-color: var(--accent);
  }

  .route-btn code {
    font-size: 0.72rem;
    color: var(--text-subtle);
    font-weight: 400;
  }

  .output {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    padding: 0.8rem 1rem;
    min-height: 4rem;
  }

  .meta {
    font-size: 0.78rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
    margin-bottom: 0.5rem;
  }

  /* The shell styles `pre` globally as a dark code block; this one is plain
     file output inside an already-tinted surface, so undo that treatment. */
  .output pre {
    margin: 0;
    padding: 0;
    background: transparent;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.85rem;
    color: var(--text);
  }

  .download {
    align-self: flex-start;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--accent);
  }
</style>
