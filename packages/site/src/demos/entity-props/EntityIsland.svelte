<script lang="ts">
  import { isBrowser } from 'mochi-framework';
  import type { MochiDirectives } from 'mochi-framework';

  let {
    label,
    quote,
    comparison,
    copyright,
    greeting,
  }: {
    label: string;
    quote: string;
    comparison: string;
    copyright: string;
    greeting: string;
  } & MochiDirectives = $props();

  // The `authored` column shows the raw attribute text as written in the parent
  // (`&amp;`, `&quot;`, …); the `value` column shows what the island actually
  // received. They must differ — the entity is decoded before it reaches the prop.
  const rows: Array<{ name: string; authored: string; value: string }> = $derived([
    { name: 'label', authored: 'Tom &amp; Jerry', value: label },
    { name: 'quote', authored: 'She said &quot;hi&quot;', value: quote },
    { name: 'comparison', authored: '5 &lt; 10 &amp;&amp; 10 &gt; 5', value: comparison },
    { name: 'copyright', authored: '&copy; 2026 Mochi', value: copyright },
    { name: 'greeting (mixed)', authored: 'Hi &amp; welcome, {name}', value: greeting },
  ]);
</script>

<div class="island">
  <p class="where">
    Rendered on: <strong>{isBrowser ? 'client (hydrated)' : 'server (SSR)'}</strong>
  </p>
  <table>
    <thead>
      <tr>
        <th>Prop</th>
        <th>Authored attribute</th>
        <th>Value received</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.name)}
        <tr>
          <td><code>{row.name}</code></td>
          <td><code>{row.authored}</code></td>
          <td class="value">{row.value}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .island {
    border: 2px solid var(--border-strong);
    border-radius: var(--radius-md);
    padding: 1rem 1.25rem;
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .where {
    margin: 0;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .where strong {
    color: var(--text);
    font-family: var(--font-mono);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  th,
  td {
    text-align: left;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }

  th {
    color: var(--text-subtle);
    font-weight: 600;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  code {
    font-family: var(--font-mono);
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.85em;
  }

  .value {
    color: var(--text);
    font-weight: 600;
  }
</style>
