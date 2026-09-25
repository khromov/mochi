<script lang="ts">
  import type { Component } from 'svelte';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import Leaf from '@lucide/svelte/icons/leaf';
  import Timer from '@lucide/svelte/icons/timer';
  import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
  import Zap from '@lucide/svelte/icons/zap';
  import Radio from '@lucide/svelte/icons/radio';
  import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
  import Database from '@lucide/svelte/icons/database';
  import Bot from '@lucide/svelte/icons/bot';
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

  const features: { icon: Component; title: string; body: string; href: string }[] = [
    {
      icon: Leaf,
      title: 'Zero JS by default',
      body: 'Every component renders to HTML. Only what you mark with mochi:hydrate ships a bundle.',
      href: '/docs/selective-hydration/',
    },
    {
      icon: Timer,
      title: 'Lazy and server islands',
      body: 'Hydrate on scroll with mochi:hydrate:visible, or stream slow parts in later with mochi:defer.',
      href: '/docs/server-islands/',
    },
    {
      icon: ArrowRightLeft,
      title: 'View Transitions',
      body: 'Animated navigations between real documents. No client router to ship or maintain.',
      href: '/docs/view-transitions/',
    },
    {
      icon: Zap,
      title: 'Built on Bun',
      body: 'Bun’s bundler instead of Vite. Hundreds of routes build in seconds.',
      href: '/docs/why-bun/',
    },
    {
      icon: Radio,
      title: 'WebSockets and SSE',
      body: 'Real-time endpoints are route types, declared next to your pages.',
      href: '/docs/websocket-routes/',
    },
    {
      icon: ClipboardCheck,
      title: 'Form actions',
      body: 'Forms work without JavaScript, then get progressively enhanced when it loads.',
      href: '/docs/progressively-enhancing-forms-with-enhance/',
    },
    {
      icon: Database,
      title: 'Data and jobs built in',
      body: 'SQLite, Postgres or MySQL, background queues, cron, cache, images and rate limiting.',
      href: '/docs/persistence/',
    },
    {
      icon: Bot,
      title: 'Ready for AI tools',
      body: 'Docs as llms.txt and an MCP server, so your assistant knows the framework.',
      href: '/docs/docs-for-llms/',
    },
  ];

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
        <h1>The light-weight, full-stack Svelte meta-framework.</h1>
        <p class="lede">Mochi is a full-stack meta-framework on Bun. Everything renders on the server; only the parts you mark ship JavaScript.</p>
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
        <p>The server does the work, so the server gets the features.</p>
      </header>

      <ul class="feature-grid">
        {#each features as feature (feature.title)}
          <li>
            <a class="feature" href={feature.href}>
              <span class="feature-icon"><feature.icon size={20} strokeWidth={1.8} /></span>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
              <span class="feature-link">Docs <ArrowRight size={14} strokeWidth={2} /></span>
            </a>
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
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
    gap: 4rem;
    align-items: center;
  }

  .hero-copy h1 {
    font-size: clamp(2.4rem, 5vw, 3.9rem);
    line-height: 1.04;
    letter-spacing: -0.025em;
    font-weight: 400;
    text-wrap: balance;
    margin-bottom: 1.25rem;
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

  .feature-grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1rem;
  }

  .feature-grid li {
    display: flex;
  }

  .feature {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding: 1.4rem 1.3rem 1.25rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    text-decoration: none;
    color: inherit;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease,
      transform 0.15s ease;
  }

  .feature:hover {
    border-color: var(--accent);
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
  }

  .feature-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.4rem;
    height: 2.4rem;
    margin-bottom: 0.35rem;
    border-radius: var(--radius-md);
    background: var(--accent-soft);
    color: var(--accent-soft-text);
  }

  .feature h3 {
    font-size: 1.15rem;
    line-height: 1.25;
  }

  .feature p {
    flex: 1;
    font-size: 0.92rem;
    line-height: 1.55;
    color: var(--text-muted);
  }

  .feature-link,
  .all-demos {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--accent);
  }

  .all-demos {
    text-decoration: none;
    font-size: 0.95rem;
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

  .demo {
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
    color: var(--text-subtle);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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

    .hero-copy h1,
    .lede {
      max-width: 22ch;
    }

    .lede {
      max-width: 44ch;
    }

    .feature-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
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

    .lede {
      font-size: 1.08rem;
    }
  }

  @media (max-width: 560px) {
    .feature-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .code-command {
      width: 100%;
    }
  }
</style>
