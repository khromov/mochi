<script lang="ts">
  import { url, isServer } from 'mochi-framework';

  let { label = '' } = $props();

  const env = isServer ? 'server' : 'client';

  function getParams(): [string, string][] {
    return [...url.searchParams] as [string, string][];
  }
</script>

<div class="url-info">
  <h3>{label} <span class="env">({env})</span></h3>

  <div class="props">
    <div class="prop"><span class="key">href</span> <code>{url.href}</code></div>
    <div class="prop"><span class="key">origin</span> <code>{url.origin}</code></div>
    <div class="prop"><span class="key">pathname</span> <code>{url.pathname}</code></div>
    <div class="prop"><span class="key">search</span> <code>{url.search || '(empty)'}</code></div>
    <div class="prop">
      <span class="key">hash</span>
      <code>{url.hash || '(empty)'}</code>
      {#if isServer}<span class="note">never sent to the server</span>{/if}
    </div>
  </div>

  {#if getParams().length > 0}
    <div class="params">
      <h4>searchParams</h4>
      {#each getParams() as [key, value] (key)}
        <div class="prop"><span class="key">{key}</span> <code>{value}</code></div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .url-info {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  h3 {
    font-size: 1.05rem;
    font-weight: 700;
    margin: 0;
    color: var(--text);
  }

  h4 {
    font-size: 0.95rem;
    font-weight: 600;
    margin: 0 0 0.3rem;
    color: var(--text-muted);
  }

  .env {
    font-weight: 400;
    color: var(--text-subtle);
    font-size: 0.85rem;
  }

  .props,
  .params {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .prop {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.95rem;
  }

  .key {
    font-family: var(--font-mono);
    font-size: 0.9rem;
    color: var(--text-muted);
    min-width: 100px;
    flex-shrink: 0;
  }

  code {
    background: var(--code-bg);
    color: var(--code-accent);
    font-family: var(--font-mono);
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    font-size: 0.85rem;
    word-break: break-all;
  }

  .note {
    font-size: 0.8rem;
    color: var(--text-subtle);
    font-style: italic;
  }
</style>
