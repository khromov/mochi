<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils';
  import { files } from './files.ts';
  import {
    counters,
    overview,
    overviewUncached,
    topWords,
    topWordsUncached,
    themes,
    themesUncached,
    extremes,
    extremesUncached,
    richness,
    richnessUncached,
  } from './analyzeBook.ts';

  const sources = await loadSources(files);

  // Five independent facets of the same book, each rendered by its own panel —
  // the shape of a page whose components each look up the value they need,
  // without knowing what the others already computed.
  const uncachedStart = performance.now();
  overviewUncached();
  topWordsUncached();
  themesUncached();
  extremesUncached();
  richnessUncached();
  const uncachedMs = Math.round(performance.now() - uncachedStart);

  const cachedStart = performance.now();
  const facetOverview = overview();
  const facetTopWords = topWords();
  const facetThemes = themes();
  const facetExtremes = extremes();
  const facetHapax = richness();
  const cachedMs = Math.round(performance.now() - cachedStart);

  const { uncached, cached } = counters();
  const nf = new Intl.NumberFormat('en-US');
  const topMax = facetTopWords[0]?.[1] ?? 1;
</script>

<DemoPage
  title="Request Cache"
  description="Analysing the full text of Robinson Crusoe — 124,000 words — takes about 20ms of pure CPU. This page shows five independent facets of that analysis, so the naive pass parses the whole book five times. requestMemo() makes it once, for the rest of this request only."
  {sources}
>
  <div class="stack">
    <div class="cards">
      <div class="card">
        <span class="card-label">Naive</span>
        <span class="card-value">{uncached} analyses</span>
        <span class="card-note">{uncachedMs}ms of CPU</span>
      </div>
      <div class="card is-good">
        <span class="card-label">requestMemo()</span>
        <span class="card-value">{cached} analysis</span>
        <span class="card-note">{cachedMs}ms of CPU</span>
      </div>
      <div class="card">
        <span class="card-label">Saved</span>
        <span class="card-value">{uncachedMs - cachedMs}ms</span>
        <span class="card-note">same five facets</span>
      </div>
    </div>

    <p class="hint">
      Both passes read the identical book — the memoized one just stops parsing it four extra times. Open the <strong>debug bar</strong> at the bottom of the page and its
      <strong>Cache</strong>
      panel: the <strong>Request cache</strong> section reports the hits, misses, and hit rate for this exact render (one miss, four hits). Reload and the numbers come back the same —
      entries die with the request, so the next visitor parses from scratch.
    </p>

    <div class="facets">
      <section class="facet">
        <h3>Overview</h3>
        <dl class="stats">
          <div><dt>Words</dt><dd>{nf.format(facetOverview.words)}</dd></div>
          <div><dt>Unique</dt><dd>{nf.format(facetOverview.unique)}</dd></div>
          <div><dt>Sentences</dt><dd>{nf.format(facetOverview.sentences)}</dd></div>
          <div><dt>Reading time</dt><dd>~{facetOverview.readingMinutes} min</dd></div>
        </dl>
      </section>

      <section class="facet">
        <h3>Top words</h3>
        <ul class="bars">
          {#each facetTopWords as [word, count] (word)}
            <li>
              <span class="bar-word">{word}</span>
              <span class="bar-track"><span class="bar-fill" style:width="{(count / topMax) * 100}%"></span></span>
              <span class="bar-count">{nf.format(count)}</span>
            </li>
          {/each}
        </ul>
      </section>

      <section class="facet">
        <h3>Themes</h3>
        <ul class="chips">
          {#each facetThemes as [word, count] (word)}
            <li><span class="chip-word">{word}</span><span class="chip-count">{nf.format(count)}</span></li>
          {/each}
        </ul>
      </section>

      <section class="facet">
        <h3>Extremes</h3>
        <p class="extreme-label">Longest word</p>
        <p class="extreme-value"><code>{facetExtremes.longestWord}</code></p>
        <p class="extreme-label">Longest sentence · {facetExtremes.longestSentenceWords} words</p>
        <blockquote>{facetExtremes.longestSentenceExcerpt.slice(0, 260)}…</blockquote>
      </section>

      <section class="facet">
        <h3>Vocabulary richness</h3>
        <p class="hapax"><strong>{nf.format(facetHapax)}</strong> words appear exactly once</p>
        <p class="extreme-label">Hapax legomena — {Math.round((facetHapax / facetOverview.unique) * 100)}% of the vocabulary</p>
      </section>
    </div>
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

  .facets {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: 0.75rem;
  }

  .facet {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1rem 1.1rem;
  }

  .facet h3 {
    margin: 0 0 0.75rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    font-weight: 500;
  }

  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem 1rem;
    margin: 0;
  }

  .stats dt {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .stats dd {
    margin: 0.1rem 0 0;
    font-size: 1.25rem;
    color: var(--text);
  }

  .bars {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .bars li {
    display: grid;
    grid-template-columns: 5rem 1fr auto;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.82rem;
  }

  .bar-word {
    color: var(--text);
  }

  .bar-track {
    height: 0.55rem;
    background: var(--border);
    border-radius: 999px;
    overflow: hidden;
  }

  .bar-fill {
    display: block;
    height: 100%;
    background: var(--badge-success-text);
    border-radius: 999px;
  }

  .bar-count {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .chips li {
    display: inline-flex;
    align-items: baseline;
    gap: 0.4rem;
    padding: 0.3rem 0.6rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 0.82rem;
  }

  .chip-word {
    color: var(--text);
  }

  .chip-count {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .extreme-label {
    margin: 0.75rem 0 0.2rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .extreme-label:first-of-type {
    margin-top: 0;
  }

  .extreme-value {
    margin: 0;
    font-size: 1.05rem;
    color: var(--text);
  }

  blockquote {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.55;
    color: var(--text-muted);
    font-style: italic;
  }

  .hapax {
    margin: 0;
    font-size: 0.95rem;
    color: var(--text);
  }

  .hapax strong {
    font-size: 1.6rem;
  }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 0.9rem;
  }
</style>
