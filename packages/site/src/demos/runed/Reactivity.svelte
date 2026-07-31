<script lang="ts">
  import { Debounced, Throttled, Previous, watch } from 'runed';

  let text = $state('');
  const debounced = new Debounced(() => text, 400);
  const throttled = new Throttled(() => text, 400);
  const previous = new Previous(() => text);

  let seq = 0;
  let log = $state<{ id: number; text: string }[]>([]);
  watch(
    () => debounced.current,
    (value, prev) => {
      log = [{ id: seq++, text: `"${prev ?? ''}" → "${value}"` }, ...log].slice(0, 5);
    },
    { lazy: true },
  );
</script>

<div class="grid">
  <label class="field">
    <span>Type here</span>
    <input type="text" bind:value={text} placeholder="Start typing…" />
  </label>

  <div class="readouts">
    <div class="row"><span class="key">live</span><code>{text || '—'}</code></div>
    <div class="row"><span class="key">Debounced (400ms)</span><code>{debounced.current || '—'}</code></div>
    <div class="row"><span class="key">Throttled (400ms)</span><code>{throttled.current || '—'}</code></div>
    <div class="row"><span class="key">Previous</span><code>{previous.current ?? '—'}</code></div>
  </div>

  <div class="watch">
    <span class="key">watch() change log</span>
    {#if log.length === 0}
      <p class="empty">Waiting for the debounced value to settle…</p>
    {:else}
      <ul>
        {#each log as entry (entry.id)}
          <li><code>{entry.text}</code></li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .grid {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .field input {
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    outline: none;
  }

  .field input:focus {
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
  }

  .readouts {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .key {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    color: var(--text-muted);
    min-width: 150px;
  }

  code {
    background: var(--code-bg);
    color: var(--code-accent);
    font-family: var(--font-mono);
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-size: 0.85rem;
  }

  .watch {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .watch ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .empty {
    font-size: 0.9rem;
    color: var(--text-subtle);
    margin: 0;
  }
</style>
