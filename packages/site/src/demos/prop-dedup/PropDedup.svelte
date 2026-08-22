<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import SharedPropsCard from './SharedPropsCard.svelte';
  import { compiled } from 'mochi-framework';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await compiled(() => loadSources(files));

  // Each payload is reused across three cards so Mochi dedupes it into one hoisted `<script type="application/json">` block instead of shipping it three times.
  const groups = [
    {
      heading: 'Group A — recipes',
      props: {
        label: '<SharedPropsCard /> · A',
        theme: { bg: '#1d2a23', fg: '#e6f1ea', accent: '#7fc89a' },
        items: [
          { id: 1, text: 'Boil water for tea' },
          { id: 2, text: 'Steep matcha 90s' },
          { id: 3, text: 'Whisk into oat milk' },
        ],
      },
    },
    {
      heading: 'Group B — TODOs',
      props: {
        label: '<SharedPropsCard /> · B',
        theme: { bg: '#26221d', fg: '#f1ece3', accent: '#d8a55c' },
        items: [
          { id: 1, text: 'Reply to design review' },
          { id: 2, text: 'Bump devalue to 5.x' },
          { id: 3, text: 'Triage prop-dedup PR' },
          { id: 4, text: 'Push staging deploy' },
        ],
      },
    },
    {
      heading: 'Group C — track',
      props: {
        label: '<SharedPropsCard /> · C',
        theme: { bg: '#1f242c', fg: '#e6ecf5', accent: '#7fa8d8' },
        items: [
          { id: 1, text: 'Distance: 5.4 km' },
          { id: 2, text: 'Pace: 5:42 / km' },
          { id: 3, text: 'HR avg: 152 bpm' },
        ],
      },
    },
  ];
</script>

<DemoPage
  title="Shared Props"
  description="When two or more islands share the same props (as serialized by devalue), the props are deduplicated to avoid shipping the same payload two or more times in one page load."
  {sources}
>
  <p class="hint">
    Each group below renders the same component three times with the same props. In the SSR: you'll find <strong>three</strong>
    <code>&lt;script type="application/json"&gt;</code>
    blocks (one per group) and nine <code>&lt;mochi-hydratable-island props-ref="…"&gt;</code> tags pointing at them. Each shared block carries a <code>data-shared</code> marker; a lone
    island (like the source code viewer on this page) still gets its own block, just without that marker.
  </p>

  {#each groups as group (group.heading)}
    <section class="group">
      <h3>{group.heading}</h3>
      <div class="row">
        <SharedPropsCard mochi:hydrate {...group.props} />
        <SharedPropsCard mochi:hydrate {...group.props} />
        <SharedPropsCard mochi:hydrate {...group.props} />
      </div>
    </section>
  {/each}
</DemoPage>

<style>
  .hint {
    margin: 0 0 1.5rem;
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1.55;
  }

  .hint code {
    font-family: var(--font-mono);
    background: var(--surface-muted);
    border: 1px solid var(--border);
    padding: 0.05em 0.3em;
    border-radius: 4px;
    font-size: 0.85em;
  }

  .group {
    margin-bottom: 2rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .group h3 {
    margin: 0;
    font-family: var(--font-serif);
    font-size: 1.05rem;
    font-weight: 500;
    color: var(--text);
  }

  .row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
  }

  @media (max-width: 640px) {
    .row {
      grid-template-columns: 1fr;
    }
  }
</style>
