<script lang="ts">
  import '@fontsource/jetbrains-mono/400.css';
  import '@fontsource/jetbrains-mono/500.css';
  import '@fontsource/jetbrains-mono/700.css';
  import '@fontsource/jetbrains-mono/800.css';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import FrontShell from '../FrontShell.svelte';
  import Footer from '../../components/Footer.svelte';
  import CodeViewer from '../../components/CodeViewer.svelte';
  import CopyCommand from './CopyCommand.svelte';
  import FeatureTabs from './FeatureTabs.svelte';
  import { highlightCode } from '../../lib/highlight.server';
  import { demoIconFor } from '../../lib/demoIcons';
  import { isExternal } from '../../lib/isExternal';
  import { demoGroups, demoCount } from '../demoGroups';
  import { serve, page, counter, island, hydrationModes, lazy, defer, forms, websocket, sse, cache, create, type CodeSample } from '../codeSamples';
  import { shippedHtml } from './shipped';
  import type { TocEntry } from '../../lib/toc';

  let { docsNav, firstDocSlug }: { docsNav: TocEntry[]; firstDocSlug: string } = $props();

  const tokens = [
    '--bg: #0b0e0a',
    '--surface: #111611',
    '--surface-muted: #0e120e',
    '--border: #222a21',
    '--border-strong: #34402f',
    '--text: #e8e6dd',
    '--text-muted: #a8ada0',
    '--text-subtle: #7d8577',
    '--accent: #a7c9a8',
    '--accent-hover: #c7e0cd',
    '--accent-text: #0b0e0a',
    '--accent-soft: #1b251c',
    '--accent-soft-text: #c7e0cd',
    '--focus-ring: 0 0 0 3px rgba(167, 201, 168, 0.3)',
    '--shadow-md: inset 0 0 0 1px rgba(255, 253, 240, 0.03), 0 1px 2px rgba(0, 0, 0, 0.4)',
    '--nav-bg: transparent',
    '--nav-border: #1a2019',
    '--nav-cta-bg: #a7c9a8',
    '--nav-cta-text: #0b0e0a',
    "--nav-brand-font: 'JetBrains Mono', ui-monospace, monospace",
    '--nav-brand-weight: 700',
    'color-scheme: dark',
  ].join('; ');

  const hl = (sample: CodeSample) => highlightCode(sample.code, sample.lang);
  const basename = (file: string) => file.split('/').pop() ?? file;

  const editorSources = await Promise.all(
    [serve, page, counter].map(async (sample) => ({
      label: basename(sample.file),
      lang: sample.lang,
      html: await hl(sample),
    })),
  );

  const [islandHtml, shippedHighlighted] = await Promise.all([hl(island), highlightCode(shippedHtml, 'html')]);

  const featureSpecs: Array<{ name: string; blurb: string; sample: CodeSample }> = [
    { name: 'Pages', blurb: 'Every route is a Svelte component rendered on the server, with props resolved by serverProps.', sample: serve },
    { name: 'Islands', blurb: 'A mochi:* directive opts one component into client JavaScript. Everything else stays HTML.', sample: hydrationModes },
    { name: 'Lazy hydration', blurb: 'Hold off hydrating until the component scrolls into the viewport. Its JS and CSS load on intersection.', sample: lazy },
    { name: 'Server islands', blurb: 'Skip a component in the first SSR pass and render it after the page loads — made for personalized fragments.', sample: defer },
    { name: 'Forms & actions', blurb: 'One action serves both the no-JS HTML POST and the enhanced JSON submit.', sample: forms },
    { name: 'WebSockets', blurb: "Mochi.ws() is backed by Bun's ServerWebSocket, with pub/sub built in.", sample: websocket },
    { name: 'Server-Sent Events', blurb: 'Mochi.sse() streams events to the browser, one handler per client connection.', sample: sse },
    { name: 'Cache', blurb: 'MochiCache wraps slow upstream calls with stale-while-revalidate semantics.', sample: cache },
  ];

  const features = await Promise.all(
    featureSpecs.map(async ({ sample, ...rest }) => ({
      ...rest,
      file: sample.file,
      html: await hl(sample),
    })),
  );
</script>

<FrontShell {docsNav} {firstDocSlug} concept={2} title="Mochi — Zero JavaScript by default" style={tokens} themeToggle={false}>
  <div class="c2">
    <section class="masthead">
      <div class="hero-grid">
        <div class="hero-copy">
          <h1 class="headline rise" style="--d: 0ms">
            Zero JavaScript <span class="dim">by default.</span><span class="caret" aria-hidden="true"></span>
          </h1>
          <p class="sub rise" style="--d: 90ms">Svelte 5 components render to HTML on Bun. Only the ones you mark as islands ship JS.</p>
          <div class="hero-actions rise" style="--d: 180ms">
            <CopyCommand mochi:hydrate command={create.code} />
            <a class="docs-link" href="/docs/{firstDocSlug}/">Read the docs <ArrowRight size={16} strokeWidth={2} aria-hidden="true" /></a>
          </div>
          <p class="requires rise" style="--d: 240ms">Requires Bun 1.4 or newer.</p>
        </div>

        <div class="hero-visual rise" style="--d: 300ms">
          <div class="editor">
            <div class="editor-bar">
              <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
              <span class="editor-path">my-mochi-app</span>
            </div>
            <CodeViewer mochi:hydrate sources={editorSources} />
          </div>

          <div class="ledger">
            <p class="ledger-head" id="c2-ledger">Shipped to the browser</p>
            <dl aria-labelledby="c2-ledger">
              <div class="ledger-row">
                <dt>HTML</dt>
                <dd>Every component, rendered on the server <span class="mark" aria-hidden="true">✓</span></dd>
              </div>
              <div class="ledger-row">
                <dt>CSS</dt>
                <dd>Scoped component styles, linked from the head <span class="mark" aria-hidden="true">✓</span></dd>
              </div>
              <div class="ledger-row js">
                <dt>JS</dt>
                <dd><span><code>Counter.svelte</code> — the only island</span> <span class="mark" aria-hidden="true">1</span></dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </section>

    <section class="section" aria-labelledby="c2-transform">
      <header class="section-head">
        <h2 id="c2-transform">You write components.<br /><span class="dim">The browser gets HTML.</span></h2>
        <p>Mark a component with <code>mochi:hydrate</code> and Mochi wraps it in an island. Nothing else on the page changes.</p>
      </header>

      <div class="transform">
        <figure class="pane">
          <figcaption><span class="pane-label">You write</span><code>src/Home.svelte</code></figcaption>
          <div class="pane-code">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html islandHtml}
          </div>
        </figure>
        <div class="transform-arrow" aria-hidden="true"><ArrowRight size={22} strokeWidth={1.6} /></div>
        <figure class="pane pane-out">
          <figcaption><span class="pane-label">The browser gets</span><code>GET /</code></figcaption>
          <div class="pane-code">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html shippedHighlighted}
          </div>
        </figure>
      </div>
      <p class="caption">
        Header and footer arrive as plain HTML and stay that way. The island carries its devalue-encoded props and a pointer to its own client module — the only JavaScript on the
        page. Names simplified; real ones carry a content hash.
      </p>
    </section>

    <section class="section" aria-labelledby="c2-features">
      <header class="section-head">
        <h2 id="c2-features">One server.<br /><span class="dim">Pages, islands and real-time.</span></h2>
        <p>Routes, forms, sockets, streams and caching are first-class in <code>Mochi.serve()</code>. Pick one to see the code.</p>
      </header>
      <FeatureTabs mochi:hydrate {features} />
    </section>

    <section class="section" id="demos" aria-labelledby="c2-demos">
      <header class="section-head">
        <h2 id="c2-demos">{demoCount} demos.<br /><span class="dim">Each one on its own page.</span></h2>
        <p>Every demo isolates one feature and ships its source alongside it.</p>
      </header>

      <div class="demo-groups">
        {#each demoGroups as group (group.category)}
          <section class="demo-group" aria-labelledby="c2-group-{group.category}">
            <h3 class="demo-group-title" id="c2-group-{group.category}">
              {group.label}<span class="demo-group-count">{group.items.length}</span>
            </h3>
            <div class="demo-grid">
              {#each group.items as demo (demo.href)}
                {@const external = isExternal(demo.href)}
                {@const meta = demoIconFor[demo.title]}
                <a class="demo-card" href={demo.href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
                  <span class="demo-card-head">
                    <span class="demo-title">{demo.title}</span>
                    {#if external}
                      <ArrowUpRight size={15} strokeWidth={1.8} aria-hidden="true" />
                    {:else if meta}
                      {@const Icon = meta.icon}
                      <span class="demo-icon" title={meta.label} aria-hidden="true"><Icon size={15} strokeWidth={1.7} /></span>
                    {/if}
                  </span>
                  <span class="demo-hook">{demo.hook}</span>
                </a>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    </section>
  </div>

  <Footer />
</FrontShell>

<style>
  .c2 {
    --mono: 'JetBrains Mono', ui-monospace, monospace;
    --amber: #d5b982;
    position: relative;
    isolation: isolate;
    flex: 1;
    background-image: radial-gradient(ellipse 80% 50% at 70% 0%, rgba(167, 201, 168, 0.1), transparent 70%), radial-gradient(rgba(232, 230, 221, 0.055) 1px, transparent 1px);
    background-size:
      100% 100%,
      22px 22px;
  }

  .c2::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    opacity: 0.35;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.18'/></svg>");
    background-size: 240px 240px;
    mix-blend-mode: soft-light;
  }

  .c2 code {
    font-family: var(--mono);
    font-size: 0.9em;
    color: var(--accent);
  }

  .c2 :global(pre) {
    font-family: var(--mono);
  }

  .masthead {
    padding: clamp(3rem, 7vw, 6rem) 2rem clamp(3rem, 6vw, 5rem);
  }

  .hero-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.08fr);
    gap: clamp(2rem, 5vw, 4.5rem);
    align-items: center;
    max-width: 1200px;
    margin: 0 auto;
  }

  .headline {
    font-family: var(--mono);
    font-size: clamp(2.5rem, 5.4vw, 4.6rem);
    font-weight: 800;
    line-height: 0.98;
    letter-spacing: -0.055em;
    color: var(--text);
    text-wrap: balance;
  }

  .dim {
    color: var(--text-subtle);
  }

  .caret {
    display: inline-block;
    width: 0.5em;
    height: 0.82em;
    margin-left: 0.08em;
    vertical-align: -0.06em;
    background: var(--accent);
    animation: blink 1.1s steps(1) infinite;
  }

  .sub {
    margin-top: 1.5rem;
    max-width: 30rem;
    font-size: 1.15rem;
    line-height: 1.55;
    color: var(--text-muted);
  }

  .hero-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1.25rem;
    margin-top: 2rem;
  }

  .docs-link {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--text);
    text-decoration: none;
    border-bottom: 1px solid var(--border-strong);
    padding-bottom: 2px;
    transition:
      color 0.15s ease,
      border-color 0.15s ease;
  }

  .docs-link:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .requires {
    margin-top: 1rem;
    font-size: 0.82rem;
    color: var(--text-subtle);
  }

  .hero-visual {
    position: relative;
    min-width: 0;
  }

  .hero-visual::before {
    content: '';
    position: absolute;
    inset: -12% -8% -6%;
    z-index: -1;
    background: radial-gradient(closest-side, rgba(167, 201, 168, 0.16), transparent);
    filter: blur(20px);
    pointer-events: none;
  }

  .editor {
    background: #0e120e;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    overflow: hidden;
    box-shadow:
      0 40px 100px -40px rgba(0, 0, 0, 0.8),
      0 0 0 1px rgba(0, 0, 0, 0.6);
  }

  .editor-bar {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    padding: 0.65rem 0.9rem;
    background: #121712;
  }

  .dots {
    display: inline-flex;
    gap: 6px;
  }

  .dots i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #2c352b;
  }

  .editor-path {
    font-family: var(--mono);
    font-size: 0.76rem;
    color: var(--text-subtle);
  }

  .editor :global(div.code-viewer) {
    margin: 0;
  }

  .editor :global(.cv-tabs) {
    gap: 0;
    margin: 0;
    background: #121712;
    border-bottom: 1px solid var(--border);
  }

  .editor :global(.cv-tabs button.cv-tab) {
    padding: 0.55rem 1rem;
    font-family: var(--mono);
    font-size: 0.78rem;
    color: var(--text-subtle);
    background: transparent;
    border-radius: 0;
    border-right: 1px solid var(--border);
    box-shadow: inset 0 -2px 0 transparent;
  }

  .editor :global(.cv-tabs button.cv-tab:hover) {
    color: var(--text);
    background: rgba(232, 230, 221, 0.03);
  }

  .editor :global(.cv-tabs button.cv-tab.active) {
    color: var(--text);
    font-weight: 500;
    background: #0e120e;
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  .editor :global(.cv-panel) {
    min-height: 21rem;
  }

  .editor :global(.cv-panel pre) {
    margin: 0;
    padding: 1.1rem 1.25rem 1.4rem;
    font-size: 0.84rem;
    line-height: 1.65;
    background: transparent;
    border-radius: 0;
  }

  .ledger {
    margin-top: 1rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: rgba(17, 22, 17, 0.7);
    overflow: hidden;
  }

  .ledger-head {
    padding: 0.6rem 1rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
  }

  .ledger-row {
    display: grid;
    grid-template-columns: 3.25rem minmax(0, 1fr);
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 1rem;
    font-size: 0.86rem;
  }

  .ledger-row + .ledger-row {
    border-top: 1px solid var(--border);
  }

  .ledger-row dt {
    font-family: var(--mono);
    font-weight: 700;
    font-size: 0.8rem;
    color: var(--text);
  }

  .ledger-row dd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-width: 0;
    color: var(--text-muted);
  }

  .mark {
    font-family: var(--mono);
    font-weight: 700;
    color: var(--accent);
  }

  .ledger-row.js {
    background: rgba(213, 185, 130, 0.06);
  }

  .ledger-row.js dt,
  .ledger-row.js .mark,
  .ledger-row.js code {
    color: var(--amber);
  }

  .ledger-row.js .mark {
    display: inline-grid;
    place-items: center;
    min-width: 1.4rem;
    height: 1.4rem;
    font-size: 0.75rem;
    border: 1px solid rgba(213, 185, 130, 0.45);
    border-radius: 4px;
  }

  .section {
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
    padding: clamp(3rem, 7vw, 5.5rem) 2rem;
    border-top: 1px solid var(--border);
  }

  .section-head {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: 1rem 3rem;
    align-items: end;
    margin-bottom: 2.5rem;
  }

  .section-head h2 {
    font-family: var(--mono);
    font-size: clamp(1.7rem, 3.2vw, 2.5rem);
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: -0.045em;
    color: var(--text);
  }

  .section-head p {
    max-width: 32rem;
    font-size: 1rem;
    line-height: 1.55;
    color: var(--text-muted);
  }

  .transform {
    display: grid;
    grid-template-columns: minmax(0, 0.8fr) auto minmax(0, 1.2fr);
    gap: 1.25rem;
    align-items: stretch;
  }

  .pane {
    display: flex;
    flex-direction: column;
    background: #0e120e;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    overflow: hidden;
  }

  .pane figcaption {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.65rem 1rem;
    font-size: 0.8rem;
    background: #121712;
    border-bottom: 1px solid var(--border);
  }

  .pane figcaption code {
    color: var(--text-subtle);
  }

  .pane-label {
    font-weight: 600;
    color: var(--text-muted);
  }

  .pane-out {
    border-color: rgba(167, 201, 168, 0.35);
  }

  .pane-out .pane-label {
    color: var(--accent);
  }

  .pane-code {
    flex: 1;
    display: flex;
    align-items: center;
  }

  .pane-code :global(.code-block) {
    flex: 1;
    min-width: 0;
  }

  .pane-code :global(pre) {
    flex: 1;
    margin: 0;
    padding: 1.1rem 1.25rem;
    font-size: 0.82rem;
    line-height: 1.65;
    background: transparent;
    border-radius: 0;
  }

  .transform-arrow {
    display: grid;
    place-items: center;
    color: var(--accent);
  }

  .caption {
    margin-top: 1.25rem;
    max-width: 48rem;
    font-size: 0.9rem;
    line-height: 1.55;
    color: var(--text-subtle);
  }

  .demo-groups {
    display: flex;
    flex-direction: column;
    gap: 2.25rem;
  }

  .demo-group-title {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.85rem;
    font-family: var(--mono);
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--text);
  }

  .demo-group-count {
    padding: 0.05rem 0.4rem;
    font-size: 0.72rem;
    font-weight: 500;
    color: var(--text-subtle);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  .demo-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 0.6rem;
  }

  .demo-card {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.9rem 1rem;
    color: inherit;
    text-decoration: none;
    background: rgba(17, 22, 17, 0.75);
    border: 1px solid var(--border);
    border-radius: 8px;
    transition:
      border-color 0.15s ease,
      transform 0.15s ease,
      background 0.15s ease;
  }

  .demo-card:hover {
    border-color: var(--accent);
    background: rgba(27, 37, 28, 0.85);
    transform: translateY(-2px);
  }

  .demo-card:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .demo-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    color: var(--text-subtle);
  }

  .demo-title {
    font-weight: 600;
    font-size: 0.93rem;
    color: var(--text);
  }

  .demo-card:hover .demo-title {
    color: var(--accent-hover);
  }

  .demo-icon {
    display: inline-flex;
    flex-shrink: 0;
  }

  .demo-hook {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--text-subtle);
  }

  @keyframes blink {
    50% {
      opacity: 0;
    }
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(14px);
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    .rise {
      animation: rise 0.7s cubic-bezier(0.2, 0.7, 0.2, 1) both;
      animation-delay: var(--d, 0ms);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .caret {
      animation: none;
    }
  }

  @media (max-width: 960px) {
    .hero-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .section-head {
      grid-template-columns: minmax(0, 1fr);
    }

    .transform {
      grid-template-columns: minmax(0, 1fr);
    }

    .transform-arrow {
      transform: rotate(90deg);
    }
  }

  @media (max-width: 640px) {
    .masthead {
      padding: 2.5rem 1rem 3rem;
    }

    .section {
      padding: 3rem 1rem;
    }

    .sub {
      font-size: 1.05rem;
    }

    .hero-actions {
      flex-direction: column;
      align-items: flex-start;
    }

    .editor :global(.cv-panel) {
      min-height: 0;
    }

    .demo-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
