<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import BatteriesDiagram from './components/BatteriesDiagram.svelte';
  import LandingShell from './components/LandingShell.svelte';
  import BrowserFrame from './components/BrowserFrame.svelte';
  import IslandCounter from './components/IslandCounter.svelte';
  import QuickStart from './components/QuickStart.svelte';
  import IslandsDemo from '../../docs/_components/IslandsDemo.svelte';
  import { highlightCode } from './lib/highlight.server';
  import { demos } from './lib/demos';
  import { demoIconFor } from './lib/demoIcons';

  // Split so the literal never closes this component's own script block.
  const endScript = '<' + '/script>';

  const componentCode = `<script lang="ts">
  let { name } = $props();
${endScript}

<h1>Hello, {name}</h1>
<p>Rendered on the server.</p>`;

  const islandCode = `<script lang="ts">
  import Counter from './Counter.svelte';
  let { name } = $props();
${endScript}

<h1>Hello, {name}</h1>
<Counter mochi:hydrate />`;

  const serveCode = `import { Mochi } from 'mochi-framework';

Mochi.serve({
  routes: {
    '/': Mochi.page('./src/Home.svelte', {
      serverProps: { name: 'Ada' },
    }),
  },
});`;

  const [componentHtml, islandHtml, serveHtml, createHtml] = await Promise.all([
    highlightCode(componentCode, 'svelte'),
    highlightCode(islandCode, 'svelte'),
    highlightCode(serveCode, 'ts'),
    highlightCode('bun create mochi@latest', 'bash'),
  ]);

  // The rotator's keyframe percentages assume exactly five phrases, 3s each, and the brush is sized to the first (widest) one.
  const phrases = ['a Svelte meta-framework', 'full-stack Svelte on Bun', 'zero JS by default', 'server-first', 'batteries included'].map((phrase) =>
    // A word joiner on each side of the hyphen stops wrapping from splitting "meta-framework".
    phrase.replaceAll('-', '\u2060-\u2060'),
  );

  const featuredTitles = [
    'Hello World',
    'Hydration Modes',
    'Server Islands',
    'Lazy Islands',
    'Real-time Chat',
    'Real-time Streams',
    'Background jobs with queues',
    'View Transitions',
    'Charts with LayerChart',
  ];

  const featuredDemos = featuredTitles.flatMap((title) => {
    const demo = demos.find((d) => d.title === title);
    const meta = demoIconFor[title];
    return demo && meta ? [{ ...demo, icon: meta.icon, label: meta.label }] : [];
  });
</script>

<LandingShell
  metaTags={{
    title: 'Mochi — SSR Framework for Svelte 5 + Bun',
    titleTemplate: '%s',
    canonical: 'https://mochi.fast/',
  }}
>
  <section class="hero">
    <div class="wrap hero-grid">
      <div class="hero-copy">
        <h1 class="headline">
          <span class="headline-lead">Mochi is</span>
          <span class="sr-only">{phrases[0]}</span>
          <span class="rotator" aria-hidden="true">
            <span class="brush-slot"><span class="brush">{phrases[0]}</span></span>
            {#each phrases as phrase, i (phrase)}
              <span class="phrase-slot" style:--i={i}>{phrase}</span>
            {/each}
          </span>
        </h1>
        <p class="lede">Built on Bun. Everything renders on the server; only the parts you mark ship JavaScript.</p>
        <div class="ctas">
          <a class="btn btn-primary" href="/docs/intro/">
            <BookOpen size={17} strokeWidth={1.9} />
            Read the docs
          </a>
          <a class="btn btn-secondary" href="#demos">
            See demos
            <ArrowRight size={16} strokeWidth={1.9} />
          </a>
        </div>
        <div class="hero-quickstart">
          <QuickStart mochi:hydrate />
        </div>
      </div>

      <div class="hero-visual">
        <BrowserFrame url="localhost:3000/">
          <div class="islands-wrap">
            <IslandsDemo mochi:hydrate />
          </div>
        </BrowserFrame>
        <p class="caption">A page in Mochi: grey boxes are plain HTML, orange boxes are islands. This diagram is itself an island, so the button works.</p>
      </div>
    </div>
  </section>

  <section class="how" aria-labelledby="how-title">
    <div class="wrap">
      <header class="section-head">
        <h2 id="how-title">How it works</h2>
        <p>Write ordinary Svelte. Decide, component by component, what the browser needs to run.</p>
      </header>

      <ol class="steps">
        <li class="step">
          <div class="step-copy">
            <h3>Write a Svelte component</h3>
            <p>Plain Svelte 5 with runes. It renders on the server on every request, and ships as HTML.</p>
          </div>
          <div class="step-pair">
            <figure class="code">
              <figcaption>src/Home.svelte</figcaption>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted server-side highlighter output -->
              {@html componentHtml}
            </figure>
            <BrowserFrame size="sm">
              <div class="rendered">
                <p class="rendered-h1">Hello, Ada</p>
                <p class="rendered-p">Rendered on the server.</p>
              </div>
            </BrowserFrame>
          </div>
        </li>

        <li class="step">
          <div class="step-copy">
            <h3>Mark the interactive bit</h3>
            <p>
              Add <code>mochi:hydrate</code> to the one component that needs state in the browser. The counter on the right is a real island.
            </p>
          </div>
          <div class="step-pair">
            <figure class="code">
              <figcaption>src/Home.svelte</figcaption>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted server-side highlighter output -->
              {@html islandHtml}
            </figure>
            <BrowserFrame size="sm">
              <div class="rendered">
                <p class="rendered-h1">Hello, Ada</p>
                <IslandCounter mochi:hydrate label="Clicks" />
              </div>
            </BrowserFrame>
          </div>
        </li>

        <li class="step">
          <div class="step-copy">
            <h3>Ship HTML and one small island</h3>
            <p>Declare the route and serve it. The browser gets the whole page as HTML, plus a script for the counter.</p>
          </div>
          <div class="step-pair">
            <figure class="code">
              <figcaption>src/index.ts</figcaption>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted server-side highlighter output -->
              {@html serveHtml}
            </figure>
            <BrowserFrame size="sm" url="DevTools · Network">
              <ul class="payload">
                <li>
                  <span class="payload-kind">HTML</span>
                  <span class="payload-name">Home, with every component rendered</span>
                </li>
                <li class="payload-island">
                  <span class="payload-kind">JS</span>
                  <span class="payload-name">Counter island</span>
                </li>
                <li class="payload-none">
                  <span class="payload-kind">JS</span>
                  <span class="payload-name">Everything else: nothing</span>
                </li>
              </ul>
            </BrowserFrame>
          </div>
        </li>
      </ol>
    </div>
  </section>

  <section class="features" aria-labelledby="features-title">
    <div class="wrap">
      <header class="section-head">
        <h2 id="features-title">A full-stack framework, not just a renderer</h2>
        <p>Everything below ships with Mochi. Switch to SvelteKit to see what you'd bring yourself.</p>
      </header>

      <BatteriesDiagram />
    </div>
  </section>

  <section class="demos" id="demos" aria-labelledby="demos-title">
    <div class="wrap">
      <header class="section-head section-head-row">
        <div>
          <h2 id="demos-title">See it running</h2>
          <p>Each demo is a real Mochi page with its source alongside.</p>
        </div>
        <a class="all-demos" href="/docs/demos/">All demos <ArrowRight size={15} strokeWidth={2} /></a>
      </header>

      <ul class="demo-grid">
        {#each featuredDemos as demo (demo.href)}
          <li>
            <a class="demo" href={demo.href}>
              <span class="demo-icon"><demo.icon size={18} strokeWidth={1.8} /></span>
              <span class="demo-text">
                <span class="demo-title">{demo.title}</span>
                <span class="demo-label">{demo.label}</span>
              </span>
            </a>
          </li>
        {/each}
      </ul>
    </div>
  </section>

  <section class="closing" aria-labelledby="closing-title">
    <div class="wrap closing-inner">
      <div class="closing-copy">
        <h2 id="closing-title">Start with HTML. Add islands where they earn it.</h2>
        <p>One command scaffolds a working app. The docs take it from there.</p>
      </div>
      <div class="closing-actions">
        <figure class="code code-command">
          <!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted server-side highlighter output -->
          {@html createHtml}
        </figure>
        <a class="btn btn-primary" href="/docs/your-first-mochi-app/">
          Build your first app
          <ArrowUpRight size={16} strokeWidth={1.9} />
        </a>
      </div>
    </div>
  </section>
</LandingShell>

<style>
  .wrap {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 1.5rem;
  }

  h1,
  h2,
  h3 {
    font-family: var(--font-serif);
    font-weight: 450;
    color: var(--text);
    letter-spacing: -0.015em;
    font-variation-settings:
      'opsz' 144,
      'SOFT' 50;
  }

  code {
    font-family: var(--font-mono);
    font-size: 0.88em;
    padding: 0.05rem 0.3rem;
    border-radius: 4px;
    background: var(--accent-soft);
    color: var(--accent-soft-text);
  }

  .hero {
    padding: 4.5rem 0 5rem;
    background: radial-gradient(ellipse 70% 60% at 85% 20%, color-mix(in srgb, var(--accent-soft) 70%, transparent), transparent 70%);
  }

  .hero-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    gap: 4rem;
    align-items: center;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .headline {
    --brush: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 60' preserveAspectRatio='none'%3E%3Cpath fill='%23b9dbbf' d='M8 16 L20 11 C80 7 150 10 220 7 C290 4 350 8 386 8 L395 15 L389 21 L397 29 L390 36 L396 45 C350 51 290 48 225 52 C160 56 90 51 36 54 L14 50 L21 43 L5 37 L15 29 L3 22 Z'/%3E%3Cpath fill='%23b9dbbf' fill-opacity='.55' d='M40 3 C140 0 280 -1 372 3 L376 7 C280 6 150 8 40 8 Z M60 55 C160 58 270 57 350 55 L346 59 C260 60 150 60 64 59 Z'/%3E%3C/svg%3E");
    font-size: clamp(2.4rem, 5vw, 3.6rem);
    line-height: 1.08;
    letter-spacing: -0.025em;
    font-weight: 400;
    margin-bottom: 1.25rem;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .headline {
      --brush: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 60' preserveAspectRatio='none'%3E%3Cpath fill='%2336613f' d='M8 16 L20 11 C80 7 150 10 220 7 C290 4 350 8 386 8 L395 15 L389 21 L397 29 L390 36 L396 45 C350 51 290 48 225 52 C160 56 90 51 36 54 L14 50 L21 43 L5 37 L15 29 L3 22 Z'/%3E%3Cpath fill='%2336613f' fill-opacity='.55' d='M40 3 C140 0 280 -1 372 3 L376 7 C280 6 150 8 40 8 Z M60 55 C160 58 270 57 350 55 L346 59 C260 60 150 60 64 59 Z'/%3E%3C/svg%3E");
    }
  }

  :global(:root[data-theme='dark']) .headline {
    --brush: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 60' preserveAspectRatio='none'%3E%3Cpath fill='%2336613f' d='M8 16 L20 11 C80 7 150 10 220 7 C290 4 350 8 386 8 L395 15 L389 21 L397 29 L390 36 L396 45 C350 51 290 48 225 52 C160 56 90 51 36 54 L14 50 L21 43 L5 37 L15 29 L3 22 Z'/%3E%3Cpath fill='%2336613f' fill-opacity='.55' d='M40 3 C140 0 280 -1 372 3 L376 7 C280 6 150 8 40 8 Z M60 55 C160 58 270 57 350 55 L346 59 C260 60 150 60 64 59 Z'/%3E%3C/svg%3E");
  }

  .headline-lead {
    display: block;
  }

  .rotator {
    display: grid;
  }

  .brush-slot,
  .phrase-slot {
    grid-area: 1 / 1;
    text-wrap: balance;
  }

  .brush-slot {
    color: transparent;
    user-select: none;
  }

  .brush {
    padding: 0 0.12em;
    margin: 0 -0.12em;
    background: var(--brush) no-repeat 0 80% / 100% 62%;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
    animation: brush-sweep 0.8s 0.3s cubic-bezier(0.6, 0, 0.3, 1) backwards;
  }

  .phrase-slot {
    position: relative;
    animation: phrase-cycle 15s calc(var(--i) * 3s) infinite backwards;
  }

  @keyframes phrase-cycle {
    0% {
      opacity: 0;
      transform: translateY(0.2em);
    }
    3%,
    17% {
      opacity: 1;
      transform: none;
    }
    20%,
    100% {
      opacity: 0;
      transform: translateY(-0.2em);
    }
  }

  @keyframes brush-sweep {
    from {
      background-size: 0% 62%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .brush,
    .phrase-slot {
      animation: none;
    }

    .phrase-slot:not(.brush-slot + .phrase-slot) {
      display: none;
    }
  }

  .lede {
    font-size: 1.2rem;
    line-height: 1.55;
    color: var(--text-muted);
    max-width: 36ch;
    margin-bottom: 1.75rem;
    text-wrap: pretty;
  }

  .ctas {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 2.25rem;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.2rem;
    border-radius: var(--radius-md);
    font-weight: 600;
    font-size: 0.98rem;
    text-decoration: none;
    border: 1px solid transparent;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
  }

  .btn:focus-visible,
  .demo:focus-visible,
  .all-demos:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .btn-primary {
    background: var(--accent);
    color: var(--accent-text);
  }

  .btn-primary:hover {
    background: var(--accent-hover);
  }

  .btn-secondary {
    background: var(--surface);
    border-color: var(--border-strong);
    color: var(--text);
  }

  .btn-secondary:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .hero-quickstart {
    max-width: 30rem;
  }

  .hero-quickstart :global(.quickstart) {
    margin-bottom: 0;
  }

  .hero-quickstart :global(.quickstart-head h2) {
    font-size: 1rem;
    font-family: var(--font-sans);
    font-weight: 600;
    color: var(--text-muted);
  }

  .hero-visual {
    min-width: 0;
  }

  .islands-wrap {
    font-size: 1.05rem;
  }

  .islands-wrap :global(.islands-demo) {
    margin: 0;
  }

  .islands-wrap :global(.page) {
    min-height: 19rem;
  }

  .caption {
    margin-top: 1rem;
    font-size: 0.88rem;
    line-height: 1.5;
    color: var(--text-subtle);
    max-width: 52ch;
  }

  section.how,
  section.features,
  section.demos {
    padding: 5rem 0;
    border-top: 1px solid var(--border);
  }

  section.features {
    background: var(--surface-muted);
  }

  .section-head {
    margin-bottom: 2.75rem;
    max-width: 44rem;
  }

  .section-head h2 {
    font-size: clamp(1.9rem, 3.4vw, 2.6rem);
    line-height: 1.1;
    margin-bottom: 0.75rem;
    text-wrap: balance;
  }

  .section-head p {
    font-size: 1.08rem;
    line-height: 1.55;
    color: var(--text-muted);
  }

  .section-head-row {
    max-width: none;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem 2rem;
    flex-wrap: wrap;
  }

  .steps {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 3.5rem;
  }

  .step {
    display: grid;
    grid-template-columns: minmax(0, 17rem) minmax(0, 1fr);
    gap: 2.5rem;
    align-items: start;
  }

  .step-copy {
    padding-top: 0.5rem;
    padding-left: 1.1rem;
    border-left: 2px solid var(--accent);
  }

  .step-copy h3 {
    font-size: 1.45rem;
    line-height: 1.2;
    margin-bottom: 0.6rem;
  }

  .step-copy p {
    color: var(--text-muted);
    line-height: 1.6;
  }

  .step-pair {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: 1.25rem;
    align-items: stretch;
  }

  .code {
    margin: 0;
    min-width: 0;
    background: var(--code-bg);
    border: 1px solid var(--code-chrome-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .code figcaption {
    padding: 0.45rem 0.9rem;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--code-muted);
    background: var(--code-chrome-bg);
    border-bottom: 1px solid var(--code-chrome-border);
  }

  .code :global(pre) {
    margin: 0;
    padding: 1rem 1.1rem;
    background: transparent;
    color: var(--code-text);
    font-family: var(--font-mono);
    font-size: 0.82rem;
    line-height: 1.6;
    overflow-x: auto;
    border: 0;
    border-radius: 0;
  }

  .rendered {
    display: grid;
    gap: 0.75rem;
    justify-items: start;
  }

  .rendered-h1 {
    font-family: var(--font-serif);
    font-size: 1.6rem;
    line-height: 1.15;
    color: var(--text);
  }

  .rendered-p {
    color: var(--text-muted);
  }

  .payload {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.5rem;
    font-size: 0.9rem;
  }

  .payload li {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-muted);
    min-width: 0;
  }

  .payload-kind {
    flex-shrink: 0;
    width: 2.7rem;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-subtle);
  }

  .payload-name {
    min-width: 0;
    color: var(--text);
  }

  .payload li.payload-island {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .payload-island .payload-kind,
  .payload-island .payload-name {
    color: var(--accent-soft-text);
  }

  .payload li.payload-none {
    border-style: dashed;
    background: transparent;
  }

  .payload-none .payload-name {
    color: var(--text-subtle);
  }

  .all-demos {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--accent);
    text-decoration: none;
  }

  .all-demos:hover {
    color: var(--accent-hover);
  }

  .demo-grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .demo-grid li {
    display: flex;
  }

  .demo {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.85rem 1rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    text-decoration: none;
    color: inherit;
    transition: border-color 0.15s ease;
  }

  .demo:hover {
    border-color: var(--accent);
  }

  .demo-icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.2rem;
    height: 2.2rem;
    border-radius: var(--radius-sm);
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--accent);
  }

  .demo-text {
    display: grid;
    min-width: 0;
  }

  .demo-title {
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .demo-label {
    font-size: 0.84rem;
    line-height: 1.4;
    color: var(--text-subtle);
  }

  .closing {
    padding: 4.5rem 0;
    background: var(--accent-soft);
    border-top: 1px solid var(--border);
  }

  .closing-inner {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 2rem 3rem;
    align-items: center;
  }

  .closing h2 {
    font-size: clamp(1.8rem, 3.2vw, 2.4rem);
    line-height: 1.12;
    color: var(--accent-soft-text);
    margin-bottom: 0.6rem;
    text-wrap: balance;
  }

  .closing-copy p {
    color: var(--accent-soft-text);
    font-size: 1.05rem;
    opacity: 0.85;
  }

  .closing-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    min-width: 0;
  }

  .code-command {
    flex-shrink: 0;
    max-width: 100%;
  }

  .code-command :global(pre) {
    padding: 0.75rem 3rem 0.75rem 1.1rem;
    font-size: 0.92rem;
  }

  @media (max-width: 1024px) {
    .hero-grid {
      grid-template-columns: minmax(0, 1fr);
      gap: 3rem;
    }

    .headline {
      max-width: 22ch;
    }

    .lede {
      max-width: 44ch;
    }

    .demo-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .step {
      grid-template-columns: minmax(0, 1fr);
      gap: 1.25rem;
    }

    .closing-inner {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 720px) {
    .wrap {
      padding: 0 1rem;
    }

    .hero {
      padding: 2.75rem 0 3.5rem;
    }

    section.how,
    section.features,
    section.demos {
      padding: 3.5rem 0;
    }

    .step-pair {
      grid-template-columns: minmax(0, 1fr);
    }

    .demo-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .headline {
      font-size: min(2.4rem, 9.4vw);
    }

    .lede {
      font-size: 1.08rem;
    }
  }

  @media (max-width: 560px) {
    .code-command {
      width: 100%;
    }
  }
</style>
