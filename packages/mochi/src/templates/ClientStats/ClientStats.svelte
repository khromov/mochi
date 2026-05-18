<script lang="ts">
  import { formatSize } from '../../debug-bar/utils';

  type Input = { path: string; size: number };
  type Output = { name: string; size: number; inputs: Input[] };

  let { stats }: { stats: { outputs: Output[] } } = $props();

  const totalSize = stats.outputs.reduce((sum, o) => sum + o.size, 0);
</script>

<svelte:head>
  <title>Runtime bundle stats</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<h1>Runtime bundle stats</h1>
<p class="subtitle">Total: {formatSize(totalSize)} across {stats.outputs.length} file(s)</p>

{#each stats.outputs as output (output.name)}
  {@const barMax = output.inputs[0]?.size || 1}
  <section>
    <h2>{output.name} <span class="total">{formatSize(output.size)}</span></h2>
    <table>
      <thead>
        <tr>
          <th>Module</th>
          <th></th>
          <th>Size</th>
          <th>%</th>
        </tr>
      </thead>
      <tbody>
        {#each output.inputs as inp (inp.path)}
          {@const barW = Math.round((inp.size / barMax) * 200)}
          {@const pct = ((inp.size / output.size) * 100).toFixed(1)}
          <tr>
            <td class="path">{inp.path}</td>
            <td class="bar"><div class="bar-fill" style:width="{barW}px"></div></td>
            <td class="size">{formatSize(inp.size)}</td>
            <td class="pct">{pct}%</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/each}

<style>
  :global(html, body) {
    margin: 0;
    overflow-x: hidden;
  }
  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }
  :global(body) {
    background: #0d1117;
    color: #c9d1d9;
    font:
      14px/1.5 ui-monospace,
      SFMono-Regular,
      Menlo,
      monospace;
    padding: 24px;
  }
  h1 {
    color: #58a6ff;
    margin-bottom: 4px;
  }
  .subtitle {
    color: #8b949e;
    margin-bottom: 32px;
  }
  h2 {
    color: #e3b341;
    font-size: 14px;
    margin: 32px 0 8px;
  }
  .total {
    color: #8b949e;
    font-weight: normal;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th {
    color: #8b949e;
    text-align: left;
    padding: 4px 8px;
    border-bottom: 1px solid #21262d;
    font-weight: normal;
  }
  td {
    padding: 3px 8px;
    border-bottom: 1px solid #161b22;
  }
  td.path {
    color: #79c0ff;
    max-width: 500px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  td.size {
    text-align: right;
    color: #a5d6ff;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  td.pct {
    text-align: right;
    color: #8b949e;
    width: 50px;
    font-variant-numeric: tabular-nums;
  }
  td.bar {
    width: 210px;
  }
  .bar-fill {
    height: 10px;
    background: #1f6feb;
    border-radius: 2px;
  }
  section {
    margin-bottom: 32px;
  }
</style>
