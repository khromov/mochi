<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import BatteriesDiagram from './components/BatteriesDiagram.svelte';
  import HeroHeadline from './components/HeroHeadline.svelte';
  import HydrateDemo from './components/HydrateDemo.svelte';
  import JsShippedChart from './components/JsShippedChart.svelte';
  import LandingShell from './components/LandingShell.svelte';
  import BrowserFrame from './components/BrowserFrame.svelte';
  import CodeFigure from './components/CodeFigure.svelte';
  import DemoCard from './components/DemoCard.svelte';
  import IslandCounter from './components/IslandCounter.svelte';
  import QuickStart from './components/QuickStart.svelte';
  import RunsOnMochi from './components/RunsOnMochi.svelte';
  import { highlightCode } from './lib/highlight.server';
  import { demos } from './lib/demos';
  import { demoIconFor } from './lib/demoIcons';
  import { moreCards } from './lib/moreCards';

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

  const [componentHtml, rawIslandHtml, serveHtml, createHtml] = await Promise.all([
    highlightCode(componentCode, 'svelte'),
    highlightCode(islandCode, 'svelte'),
    highlightCode(serveCode, 'ts'),
    highlightCode('bun create mochi@latest', 'bash'),
  ]);

  const islandHtml = rawIslandHtml.replace('<span class="tok attr_name">mochi</span>:<span class="tok attr_name">hydrate</span>', '<span class="hydrate-mark">$&</span>');

  // TODO: point at the Mochi vs SvelteKit comparison project.
  const comparisonProjectUrl = '#';

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

  // The live grid is four wide; the fifth card only appears in the bento draft.
  const liveCards = moreCards.filter((card) => card.id !== 'testing');

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
        <HeroHeadline mochi:hydrate />
        <p class="lede">Server-rendered Svelte on Bun. Pages ship as HTML, and only the components you mark interactive ship JavaScript.</p>
        <p class="uses">Built for marketing sites, docs, blogs, and full-stack apps that need forms, background jobs, and real-time updates.</p>
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
        <HydrateDemo mochi:hydrate />
        <p class="caption">Mochi lets you mark interactive components where needed. The rest ship as lightweight HTML.</p>
      </div>
    </div>
  </section>

  <section class="how" aria-labelledby="how-title">
    <div class="wrap">
      <header class="section-head">
        <h2 id="how-title">How Mochi works</h2>
        <p>Write normal Svelte components and decide per component what runs in the browser.</p>
      </header>

      <ol class="steps">
        <li class="step">
          <div class="step-copy">
            <h3>Write a Svelte component</h3>
            <p>The Svelte you know and love, rendered with fast, progressively enhanced HTML.</p>
          </div>
          <div class="step-pair">
            <CodeFigure caption="src/Home.svelte" html={componentHtml} copyable={false} />
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
              Add <code>mochi:hydrate</code> to the components that need to be interactive in the browser.
            </p>
          </div>
          <div class="step-pair">
            <CodeFigure caption="src/Home.svelte" html={islandHtml} copyable={false} class="code-marked" />
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
            <h3>Ship HTML and nimble islands</h3>
            <p>Declare the route and serve it. The browser gets the whole page as HTML, plus a script for the counter.</p>
          </div>
          <div class="step-pair">
            <CodeFigure caption="src/index.ts" html={serveHtml} copyable={false} />
            <BrowserFrame size="sm" url="devtools · network">
              <ul class="payload">
                <li>
                  <span class="payload-kind">HTML</span>
                  <span class="payload-name">Lightweight HTML shell with all non-hydrated components</span>
                </li>
                <li class="payload-island">
                  <span class="payload-kind">JS</span>
                  <span class="payload-name">Counter island</span>
                </li>
              </ul>
            </BrowserFrame>
          </div>
        </li>
      </ol>
    </div>
  </section>

  <section class="perf" aria-labelledby="perf-title">
    <div class="wrap perf-grid">
      <div class="section-head perf-copy">
        <h2 id="perf-title">Less JavaScript, by construction</h2>
        <p>Pages render to HTML on the server. Only islands ship JavaScript, so the same app sends a fraction of the code a fully hydrated SvelteKit build does.</p>
        <a class="all-demos" href={comparisonProjectUrl}>See the comparison project <ArrowRight size={15} strokeWidth={2} /></a>
      </div>
      <JsShippedChart />
    </div>
  </section>

  <section class="features" aria-labelledby="features-title">
    <div class="wrap">
      <header class="section-head">
        <h2 id="features-title">Everything a real site needs, built in</h2>
        <p>Forget about looking for third party services or packages. Databases, caching, email and real-time are built in. That's what we call "batteries included"</p>
      </header>

      <BatteriesDiagram />
    </div>
  </section>

  <section class="more" aria-labelledby="more-title">
    <div class="wrap">
      <header class="section-head">
        <h2 id="more-title">From first commit to production</h2>
        <p>The parts of a project that aren't the page.</p>
      </header>

      <ul class="more-grid">
        {#each liveCards as card (card.href)}
          <li class="more-card">
            <span class="more-icon"><card.icon size={20} strokeWidth={1.8} /></span>
            <h3>{card.title}</h3>
            <p>{card.body}</p>
            <a class="all-demos" href={card.href}>{card.cta} <ArrowRight size={15} strokeWidth={2} /></a>
          </li>
        {/each}
      </ul>
    </div>
  </section>

  <section class="demos" id="demos" aria-labelledby="demos-title">
    <div class="wrap">
      <header class="section-head section-head-row">
        <div>
          <h2 id="demos-title">See it running</h2>
          <p>Each demo is a real Mochi page with its source alongside.</p>
        </div>
        <a class="all-demos" href="/demos/">All demos <ArrowRight size={15} strokeWidth={2} /></a>
      </header>

      <ul class="demo-grid">
        {#each featuredDemos as demo (demo.href)}
          <li><DemoCard href={demo.href} title={demo.title} label={demo.label} icon={demo.icon} /></li>
        {/each}
      </ul>
    </div>
  </section>

  <section class="runs" aria-labelledby="runs-title">
    <div class="wrap">
      <header class="section-head section-head-row">
        <div>
          <h2 id="runs-title">Runs on Mochi</h2>
          <p>Sites built on the framework.</p>
        </div>
        <p class="runs-share">Built something with Mochi? <a href="/discord/">Tell us on Discord</a>.</p>
      </header>
      <RunsOnMochi mochi:hydrate />
    </div>
  </section>

  <section class="closing" aria-labelledby="closing-title">
    <div class="wrap closing-inner">
      <div class="closing-copy">
        <h2 id="closing-title">Ship HTML by default. Hydrate only what needs it.</h2>
        <p>One command scaffolds a working app. The tutorial takes it from there.</p>
      </div>
      <div class="closing-actions">
        <CodeFigure html={createHtml} class="code-command" />
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
    --hero-bg: color-mix(in srgb, var(--surface) 65%, var(--bg));
    --paper: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.33 0 0 0 0 0.29 0 0 0 0 0.2 0 0 0 0.16 0'/%3E%3C/filter%3E%3Crect width='100%' height='100%' filter='url(%23g)'/%3E%3C/svg%3E");
    --angle: var(--border-strong);
    overflow: hidden;
    padding: 4.5rem 0 5rem;
    background: var(--paper), var(--hero-bg);
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .hero {
      --hero-bg: var(--bg);
      --paper: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 0.98 0 0 0 0 0.9 0 0 0 0.07 0'/%3E%3C/filter%3E%3Crect width='100%' height='100%' filter='url(%23g)'/%3E%3C/svg%3E");
    }
  }

  :global(:root[data-theme='dark']) .hero {
    --hero-bg: var(--bg);
    --paper: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 0.98 0 0 0 0 0.9 0 0 0 0.07 0'/%3E%3C/filter%3E%3Crect width='100%' height='100%' filter='url(%23g)'/%3E%3C/svg%3E");
  }

  .hero-grid {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    gap: 5rem;
    align-items: center;
  }

  .hero-grid::before,
  .hero-grid::after {
    --echo: 10px;
    --angle-out: clamp(0px, (100vw - 1200px) / 2 - 2.5rem, 2rem);
    content: '';
    position: absolute;
    width: calc(4rem + 2 * var(--echo));
    height: calc(4rem + 2 * var(--echo));
    pointer-events: none;
  }

  .hero-grid::before {
    top: calc(-2rem - 2 * var(--echo));
    right: calc(-1 * var(--angle-out) - 2 * var(--echo));
    background:
      linear-gradient(var(--angle) 0 0) right calc(2 * var(--echo)) top calc(2 * var(--echo)) / 4rem 1px no-repeat,
      linear-gradient(var(--angle) 0 0) right calc(2 * var(--echo)) top calc(2 * var(--echo)) / 1px 4rem no-repeat,
      linear-gradient(color-mix(in srgb, var(--angle) 55%, transparent) 0 0) right var(--echo) top var(--echo) / 3.25rem 1px no-repeat,
      linear-gradient(color-mix(in srgb, var(--angle) 55%, transparent) 0 0) right var(--echo) top var(--echo) / 1px 3.25rem no-repeat,
      linear-gradient(color-mix(in srgb, var(--angle) 25%, transparent) 0 0) right 0px top 0px / 2.5rem 1px no-repeat,
      linear-gradient(color-mix(in srgb, var(--angle) 25%, transparent) 0 0) right 0px top 0px / 1px 2.5rem no-repeat;
  }

  .hero-grid::after {
    bottom: calc(-2rem - 2 * var(--echo));
    left: calc(-1 * var(--angle-out) - 2 * var(--echo));
    background:
      linear-gradient(var(--angle) 0 0) left calc(2 * var(--echo)) bottom calc(2 * var(--echo)) / 4rem 1px no-repeat,
      linear-gradient(var(--angle) 0 0) left calc(2 * var(--echo)) bottom calc(2 * var(--echo)) / 1px 4rem no-repeat,
      linear-gradient(color-mix(in srgb, var(--angle) 55%, transparent) 0 0) left var(--echo) bottom var(--echo) / 3.25rem 1px no-repeat,
      linear-gradient(color-mix(in srgb, var(--angle) 55%, transparent) 0 0) left var(--echo) bottom var(--echo) / 1px 3.25rem no-repeat,
      linear-gradient(color-mix(in srgb, var(--angle) 25%, transparent) 0 0) left 0px bottom 0px / 2.5rem 1px no-repeat,
      linear-gradient(color-mix(in srgb, var(--angle) 25%, transparent) 0 0) left 0px bottom 0px / 1px 2.5rem no-repeat;
  }

  .lede {
    font-size: 1.2rem;
    line-height: 1.55;
    color: var(--text-muted);
    max-width: 36ch;
    margin-bottom: 1.75rem;
    text-wrap: pretty;
  }

  .uses {
    font-size: 0.95rem;
    line-height: 1.5;
    color: var(--text-subtle);
    max-width: 40ch;
    margin: -0.9rem 0 1.75rem;
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

  .caption {
    margin-top: 1rem;
    font-size: 0.88rem;
    line-height: 1.5;
    color: var(--text-subtle);
    max-width: 52ch;
  }

  section.how,
  section.perf,
  section.features,
  section.more,
  section.demos,
  section.runs {
    padding: 5rem 0;
    border-top: 1px solid var(--border);
  }

  .runs-share {
    font-size: 0.92rem;
    color: var(--text-subtle);
  }

  .runs-share a {
    color: var(--accent);
  }

  .more-grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1rem;
  }

  .more-card {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 1.35rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .more-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.4rem;
    height: 2.4rem;
    border-radius: var(--radius-sm);
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--accent);
  }

  .more-card h3 {
    font-size: 1.2rem;
    line-height: 1.2;
    margin-top: 0.3rem;
  }

  .more-card p {
    flex: 1;
    font-size: 0.95rem;
    line-height: 1.55;
    color: var(--text-muted);
  }

  .perf-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
    gap: 4rem;
    align-items: center;
  }

  .section-head.perf-copy {
    margin-bottom: 0;
  }

  .perf-copy p {
    max-width: 40ch;
    margin-bottom: 1.25rem;
    text-wrap: pretty;
  }

  section.how {
    background: var(--surface);
  }

  section.features,
  section.demos {
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

  .step-pair :global(.code-marked .hydrate-mark) {
    padding-bottom: 0.45em;
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 14' preserveAspectRatio='none'%3E%3Cpath d='M3 8.5C38 4.5 74 5.8 110 6.2c31 .4 58-.6 87-2.4' fill='none' stroke='%238ab79a' stroke-width='2.6' stroke-linecap='round' vector-effect='non-scaling-stroke'/%3E%3Cpath d='M16 11.2c42-2.6 94-3.1 150-1.9' fill='none' stroke='%238ab79a' stroke-width='1.6' stroke-linecap='round' vector-effect='non-scaling-stroke' opacity='.75'/%3E%3C/svg%3E")
      no-repeat left bottom / 100% 0.6em;
  }

  .step-pair :global(.code-marked pre) {
    padding-bottom: 1.5rem;
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

  .closing-actions :global(.code-command) {
    flex-shrink: 0;
    max-width: 100%;
  }

  .closing-actions :global(.code-command pre) {
    padding: 0.75rem 3rem 0.75rem 1.1rem;
    font-size: 0.92rem;
  }

  @media (max-width: 1024px) {
    .hero-grid {
      grid-template-columns: minmax(0, 1fr);
      gap: 3.5rem;
    }

    .perf-grid {
      grid-template-columns: minmax(0, 1fr);
      gap: 2rem;
    }

    .lede {
      max-width: 44ch;
    }

    .demo-grid,
    .more-grid {
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

    .hero-grid::before,
    .hero-grid::after {
      display: none;
    }

    .hero {
      padding: 2.75rem 0 3.5rem;
    }

    section.how,
    section.perf,
    section.features,
    section.more,
    section.demos,
    section.runs {
      padding: 3.5rem 0;
    }

    .step-pair {
      grid-template-columns: minmax(0, 1fr);
    }

    .demo-grid,
    .more-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .lede {
      font-size: 1.08rem;
    }
  }

  @media (max-width: 560px) {
    .closing-actions :global(.code-command) {
      width: 100%;
    }
  }
</style>
