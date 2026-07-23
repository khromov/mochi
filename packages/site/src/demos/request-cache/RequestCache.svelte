<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils';
  import { files } from './files.ts';
  import { blockHashCached, blockHashUncached, counters } from './mochicoin.ts';

  const sources = await loadSources(files);

  // Nine MochiCoin transactions confirmed across three blocks. Every row wants
  // its block's hash — the same shape as a page whose components each look up
  // the value they need, without knowing what the others already computed.
  const ledger = [
    { from: 'mochi1qx…7f2a', amount: 12.5, block: 'block-841' },
    { from: 'mochi1ze…08c4', amount: 0.75, block: 'block-842' },
    { from: 'mochi1lm…b31d', amount: 240.0, block: 'block-841' },
    { from: 'mochi1qq…4e77', amount: 3.2, block: 'block-843' },
    { from: 'mochi1vv…9a10', amount: 88.0, block: 'block-842' },
    { from: 'mochi1kd…c5f1', amount: 1.05, block: 'block-841' },
    { from: 'mochi1tt…2b60', amount: 17.4, block: 'block-843' },
    { from: 'mochi1nr…6d8e', amount: 500.0, block: 'block-842' },
    { from: 'mochi1ws…af39', amount: 9.99, block: 'block-841' },
  ];

  const uncachedStart = performance.now();
  const uncachedHashes = ledger.map((tx) => blockHashUncached(tx.block));
  const uncachedMs = Math.round(performance.now() - uncachedStart);

  // Note the arrow function: handing `blockHashCached` straight to `.map()`
  // would pass the index and the array as extra arguments, and those land in
  // the cache key — every row would miss.
  const cachedStart = performance.now();
  const cachedHashes = ledger.map((tx) => blockHashCached(tx.block));
  const cachedMs = Math.round(performance.now() - cachedStart);

  const { uncached, cached } = counters();
  const rows = ledger.map((tx, i) => ({ ...tx, hash: cachedHashes[i], matches: cachedHashes[i] === uncachedHashes[i] }));
  const short = (hash) => `${hash.slice(0, 10)}…${hash.slice(-6)}`;
</script>

<DemoPage
  title="Request Cache"
  description="MochiCoin mines a block hash with 60,000 rounds of SHA-256 — about 15ms of pure CPU, every time. This ledger renders nine transactions across three blocks, so the naive pass mines nine times. requestMemo() makes it three, for the rest of this request only."
  {sources}
>
  <div class="stack">
    <div class="cards">
      <div class="card">
        <span class="card-label">Naive</span>
        <span class="card-value">{uncached} mines</span>
        <span class="card-note">{uncachedMs}ms of CPU</span>
      </div>
      <div class="card is-good">
        <span class="card-label">requestMemo()</span>
        <span class="card-value">{cached} mines</span>
        <span class="card-note">{cachedMs}ms of CPU</span>
      </div>
      <div class="card">
        <span class="card-label">Saved</span>
        <span class="card-value">{uncachedMs - cachedMs}ms</span>
        <span class="card-note">same nine hashes</span>
      </div>
    </div>

    <p class="hint">
      Both passes produce identical hashes — the second one just stops paying for the six duplicates. Open the <strong>debug bar</strong> at the bottom of the page and its
      <strong>Cache</strong>
      panel: the <strong>Request cache</strong> section reports the hits, misses, and hit rate for this exact render. Reload and the numbers come back the same — entries die with the
      request, so the next visitor mines from scratch.
    </p>

    <table>
      <thead>
        <tr>
          <th>From</th>
          <th class="num">Amount</th>
          <th>Block</th>
          <th>Block hash</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.from)}
          <tr>
            <td><code>{row.from}</code></td>
            <td class="num">{row.amount.toFixed(2)} MOC</td>
            <td class="muted">{row.block}</td>
            <td><code class="hash" class:mismatch={!row.matches}>{short(row.hash)}</code></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</DemoPage>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.75rem;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 0.9rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .card.is-good {
    border-color: var(--badge-success-text);
  }

  .card-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .card-value {
    font-size: 1.5rem;
    line-height: 1.1;
    color: var(--text);
  }

  .card-note {
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .hint {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin: 0;
    line-height: 1.6;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }

  th,
  td {
    text-align: left;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--border);
  }

  th.num,
  td.num {
    text-align: right;
  }

  th {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    font-weight: 500;
  }

  td.muted {
    color: var(--text-muted);
  }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 0.82rem;
  }

  .hash {
    color: var(--text-muted);
  }

  .hash.mismatch {
    color: var(--badge-danger-text);
  }
</style>
