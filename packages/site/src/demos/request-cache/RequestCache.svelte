<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import { compiled } from 'mochi-framework';
  import { loadSources } from '../../components/utils';
  import { highlightCode } from '../../lib/highlight.server';
  import { files } from './files.ts';
  import { overview, topWords, themes, extremes, richness } from './analyzeBook.ts';

  const sources = await compiled(() => loadSources(files));

  // Each helper wraps the same memoized analysis, so these five calls parse the book exactly once.
  const facetOverview = overview();
  const facetTopWords = topWords();
  const facetThemes = themes();
  const facetExtremes = extremes();
  const facetHapax = richness();

  const nf = new Intl.NumberFormat('en-US');
  const topMax = facetTopWords[0]?.[1] ?? 1;

  // Snippets show the real pipeline so each panel's code matches what it renders.
  const snip = (pick) => highlightCode(`// parsed once per request, shared across panels\nconst analyzeCached = requestMemo(() => analyze(BOOK));\n${pick}`, 'ts');
  const codeOverview = await snip('const { words, unique, sentences } = analyzeCached();');
  const codeTopWords = await snip('const { topWords } = analyzeCached();');
  const codeThemes = await snip('const { themes } = analyzeCached();');
  const codeExtremes = await snip('const { longestWord, longestSentenceExcerpt } = analyzeCached();');
  const codeRichness = await snip('const { hapax } = analyzeCached();');
</script>

<DemoPage
  title="Request Cache"
  description="Five independent helpers each read the full text of Robinson Crusoe, but requestMemo() parses the 124k-word book only once per request — the first call analyses it, the other four are instant cache hits, and the whole cache is thrown away when the request ends."
  {sources}
>
  <div class="stack">
    <p class="hint">
      Each panel calls its own helper, but they all share one memoized analysis — a single parse per request, so one miss and four hits. Open the
      <strong>debug bar</strong> (bottom right) and its <strong>Cache</strong> tab to check the stats.
    </p>

    <div class="facets">
      <section class="facet">
        <h3>Overview</h3>
        <dl class="stats">
          <div>
            <dt>Words</dt>
            <dd>{nf.format(facetOverview.words)}</dd>
          </div>
          <div>
            <dt>Unique</dt>
            <dd>{nf.format(facetOverview.unique)}</dd>
          </div>
          <div>
            <dt>Sentences</dt>
            <dd>{nf.format(facetOverview.sentences)}</dd>
          </div>
          <div>
            <dt>Reading time</dt>
            <dd>~{facetOverview.readingMinutes} min</dd>
          </div>
        </dl>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="snippet">{@html codeOverview}</div>
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
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="snippet">{@html codeTopWords}</div>
      </section>

      <section class="facet">
        <h3>Themes</h3>
        <ul class="chips">
          {#each facetThemes as [word, count] (word)}
            <li><span class="chip-word">{word}</span><span class="chip-count">{nf.format(count)}</span></li>
          {/each}
        </ul>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="snippet">{@html codeThemes}</div>
      </section>

      <section class="facet">
        <h3>Extremes</h3>
        <p class="extreme-label">Longest word</p>
        <p class="extreme-value"><code>{facetExtremes.longestWord}</code></p>
        <p class="extreme-label">Longest sentence · {facetExtremes.longestSentenceWords} words</p>
        <blockquote>{facetExtremes.longestSentenceExcerpt.slice(0, 260)}…</blockquote>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="snippet">{@html codeExtremes}</div>
      </section>

      <section class="facet">
        <h3>Vocabulary richness</h3>
        <p class="hapax"><strong>{nf.format(facetHapax)}</strong> words appear exactly once</p>
        <p class="extreme-label">Hapax legomena — {Math.round((facetHapax / facetOverview.unique) * 100)}% of the vocabulary</p>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="snippet">{@html codeRichness}</div>
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

  .hint {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin: 0;
    line-height: 1.6;
  }

  .facets {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: 0.75rem;
  }

  .facet {
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 0.7rem 1.1rem 1rem;
  }

  .facet h3 {
    margin: 0 0 0.7rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    font-weight: 500;
  }

  .snippet {
    margin-top: auto;
    padding-top: 1rem;
    font-size: 0.76rem;
    overflow-x: auto;
  }

  .snippet :global(pre) {
    margin: 0;
    padding: 0.6rem 0.75rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
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
