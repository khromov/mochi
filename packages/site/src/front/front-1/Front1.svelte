<script lang="ts">
  import FrontShell from '../FrontShell.svelte';
  import QuickStart from '../../components/QuickStart.svelte';
  import Footer from '../../components/Footer.svelte';
  import IslandsDemo from '../../../../docs/_components/IslandsDemo.svelte';
  import { highlightCode } from '../../lib/highlight.server';
  import { demoIconFor } from '../../lib/demoIcons';
  import { isExternal } from '../../lib/isExternal';
  import { demoGroups } from '../demoGroups';
  import * as samples from '../codeSamples';
  import type { TocEntry } from '../../lib/toc';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import CirclePlay from '@lucide/svelte/icons/circle-play';
  import Feather from '@lucide/svelte/icons/feather';
  import ScanEye from '@lucide/svelte/icons/scan-eye';
  import Server from '@lucide/svelte/icons/server';
  import AppWindow from '@lucide/svelte/icons/app-window';
  import Zap from '@lucide/svelte/icons/zap';
  import Radio from '@lucide/svelte/icons/radio';
  import SendHorizontal from '@lucide/svelte/icons/send-horizontal';
  import Database from '@lucide/svelte/icons/database';

  let { docsNav, firstDocSlug }: { docsNav: TocEntry[]; firstDocSlug: string } = $props();

  const steps = [
    {
      title: 'Write components',
      body: 'Plain Svelte 5 components with runes. There is nothing Mochi-specific in them.',
      sample: samples.counter,
    },
    {
      title: 'Mark the islands',
      body: 'Pages render on the server on every request. Add mochi:hydrate to the components that need to be interactive; the rest ship as HTML.',
      sample: samples.page,
    },
    {
      title: 'Serve it',
      body: 'Register the page with Mochi.serve() on Bun. No Vite, no client-side router.',
      sample: samples.serve,
    },
  ];

  const highlighted = await Promise.all(steps.map((s) => highlightCode(s.sample.code, s.sample.lang)));

  const features = [
    {
      icon: Feather,
      title: 'Zero JS by default',
      body: 'Pages ship as plain HTML. Only islands load JavaScript: less to download on first load, and better bfcache behaviour.',
      href: '/docs/selective-hydration/',
    },
    {
      icon: ScanEye,
      title: 'Lazy hydration',
      body: 'mochi:hydrate:visible waits until an island scrolls into view. If nobody scrolls there, it never hydrates.',
      href: '/docs/lazy-hydration/',
    },
    {
      icon: Server,
      title: 'Server islands',
      body: 'mochi:defer renders personalised fragments after the page loads, so the page around them stays cacheable.',
      href: '/docs/server-islands/',
    },
    {
      icon: AppWindow,
      title: 'Uses the platform',
      body: 'First-class View Transitions. No client-side router and no state to keep between requests.',
      href: '/docs/view-transitions/',
    },
    { icon: Zap, title: 'No Vite', body: 'The Bun bundler builds sites with hundreds of routes in seconds.', href: '/docs/why-bun/' },
    { icon: Radio, title: 'Real-time built in', body: 'WebSockets and Server-Sent Events are route types. No extra packages or services.', href: '/docs/websocket-routes/' },
    {
      icon: SendHorizontal,
      title: 'Forms without JS',
      body: 'Form actions handle plain HTML POSTs, and enhance() upgrades them when an island is present.',
      href: '/docs/progressively-enhancing-forms-with-enhance/',
    },
    { icon: Database, title: 'Cache and queues', body: 'A stale-while-revalidate cache, background queues and scheduled jobs ship with the framework.', href: '/docs/cache/' },
  ];
</script>

<FrontShell {docsNav} {firstDocSlug} concept={1} title="Mochi — Server-rendered Svelte, JavaScript only where it earns its place">
  <div class="c1">
    <section class="masthead">
      <div class="grid-bg" aria-hidden="true"></div>
      <div class="frame">
        <span class="tick tl" aria-hidden="true"></span>
        <span class="tick tr" aria-hidden="true"></span>
        <span class="tick bl" aria-hidden="true"></span>
        <span class="tick br" aria-hidden="true"></span>

        <a class="announce rise" href="/blog/this-week-in-svelte/">
          <CirclePlay size={15} strokeWidth={1.8} aria-hidden="true" />
          Watch the Mochi demo on This Week in Svelte
          <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
        </a>

        <h1 class="rise" style="--d: 80ms">
          <span class="nowrap">Server-rendered</span> Svelte.
          <span class="line-2">JavaScript only where it <span class="earns">earns its place.</span></span>
        </h1>

        <p class="sub rise" style="--d: 160ms">
          Mochi is an islands framework for Svelte 5 on Bun. Every page renders to plain HTML on the server; only the components you mark as islands ship JavaScript.
        </p>

        <div class="ctas rise" style="--d: 240ms">
          <a class="btn btn-primary" href="/docs/{firstDocSlug}/">Get started <ArrowRight size={16} strokeWidth={2} aria-hidden="true" /></a>
          <a class="btn btn-ghost" href="#demos">Browse demos</a>
        </div>

        <div class="quick rise" style="--d: 320ms">
          <QuickStart mochi:hydrate />
        </div>
      </div>
    </section>

    <section class="how" aria-labelledby="how-title">
      <header class="section-head">
        <h2 id="how-title">From component to page in three steps</h2>
        <p>If you know Svelte, you already know Mochi. The only new idea is where the JavaScript goes.</p>
      </header>

      <ol class="steps">
        {#each steps as step, i (step.title)}
          <li class="step">
            <div class="step-head">
              <span class="step-num" aria-hidden="true">{i + 1}</span>
              <h3>{step.title}</h3>
            </div>
            <p class="step-body">{step.body}</p>
            <div class="code">
              <div class="code-file">{step.sample.file}</div>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html highlighted[i]}
            </div>
          </li>
        {/each}
      </ol>

      <div class="figure">
        <div class="figure-copy">
          <h3>Only the islands wake up</h3>
          <p>
            The header, main column and footer arrive as HTML and stay that way. The profile badge and the sidebar are islands: same HTML on first paint, with JavaScript attached
            on top.
          </p>
          <a class="text-link" href="/docs/intro/#server-rendered-with-island-interactivity">How islands work <ArrowRight size={14} strokeWidth={2} aria-hidden="true" /></a>
        </div>
        <div class="figure-demo">
          <IslandsDemo mochi:hydrate />
        </div>
      </div>
    </section>

    <section class="features" aria-labelledby="features-title">
      <header class="section-head">
        <h2 id="features-title">A small core, with the batteries included</h2>
        <p>
          Everything a content site or small app needs is built in and runs on Bun. <a class="text-link" href="/docs/mochi-vs-sveltekit/">See how Mochi compares to SvelteKit</a>.
        </p>
      </header>

      <ul class="feature-grid">
        {#each features as feature (feature.title)}
          {@const Icon = feature.icon}
          <li>
            <a class="feature" href={feature.href}>
              <span class="feature-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.6} /></span>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </a>
          </li>
        {/each}
      </ul>
    </section>

    <section class="demos" id="demos" aria-labelledby="demos-title">
      <header class="section-head">
        <h2 id="demos-title">Demos</h2>
        <p>Each demo is one page that shows one feature, with its source code alongside.</p>
      </header>

      <div class="demo-groups">
        {#each demoGroups as group (group.category)}
          <section class="demo-group" aria-labelledby="c1-group-{group.category}">
            <h3 class="demo-group-label" id="c1-group-{group.category}">{group.label}</h3>
            <div class="demo-grid">
              {#each group.items as demo (demo.href)}
                {@const meta = demoIconFor[demo.title]}
                <a class="demo" href={demo.href} target={isExternal(demo.href) ? '_blank' : undefined}>
                  <span class="demo-head">
                    <span class="demo-title">{demo.title}</span>
                    {#if meta}
                      {@const Icon = meta.icon}
                      <span class="demo-icon" title={meta.label} aria-hidden="true"><Icon size={16} strokeWidth={1.6} /></span>
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

    <section class="closing hero">
      <div class="closing-inner">
        <h2>Start with HTML. Add islands when you need them.</h2>
        <div class="ctas">
          <a class="btn btn-light" href="/docs/{firstDocSlug}/">Read the docs <ArrowRight size={16} strokeWidth={2} aria-hidden="true" /></a>
          <a class="btn btn-outline-light" href="/discord/" target="_blank" rel="noopener noreferrer">Join the Discord</a>
        </div>
      </div>
    </section>

    <Footer />
  </div>
</FrontShell>

<style>
  .c1 {
    --grid-line: rgba(47, 61, 51, 0.07);
    --tick: var(--border-strong);
    --wide: 1180px;
    display: flex;
    flex-direction: column;
    flex: 1;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .c1 {
      --grid-line: rgba(232, 230, 221, 0.05);
    }
  }

  :global([data-theme='dark']) .c1 {
    --grid-line: rgba(232, 230, 221, 0.05);
  }

  .masthead {
    position: relative;
    padding: 3.5rem 2rem 4.5rem;
    overflow: hidden;
  }

  .grid-bg {
    position: absolute;
    inset: 0;
    background-image: linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
    background-size: 56px 56px;
    background-position: center top;
    mask-image: radial-gradient(ellipse 70% 80% at 50% 35%, #000 30%, transparent 78%);
    pointer-events: none;
  }

  .frame {
    position: relative;
    max-width: 920px;
    margin: 0 auto;
    padding: 3.5rem 3rem 2.75rem;
    text-align: center;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg) 70%, transparent);
  }

  .tick {
    position: absolute;
    width: 9px;
    height: 9px;
    background: var(--bg);
    border: 1px solid var(--tick);
  }

  .tl {
    top: -5px;
    left: -5px;
  }

  .tr {
    top: -5px;
    right: -5px;
  }

  .bl {
    bottom: -5px;
    left: -5px;
  }

  .br {
    bottom: -5px;
    right: -5px;
  }

  .announce {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 2rem;
    padding: 0.4rem 0.8rem;
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--accent-soft-text);
    background: var(--accent-soft);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    border-radius: var(--radius-md);
    text-decoration: none;
    transition: border-color 0.15s ease;
  }

  .announce:hover {
    border-color: var(--accent);
  }

  h1 {
    font-family: var(--font-serif);
    font-size: clamp(2.4rem, 5.6vw, 4.4rem);
    font-weight: 450;
    font-variation-settings:
      'opsz' 144,
      'SOFT' 50,
      'WONK' 1;
    line-height: 1.02;
    letter-spacing: -0.025em;
    color: var(--text);
    text-wrap: balance;
  }

  .line-2 {
    display: block;
    color: var(--text-muted);
  }

  .earns {
    color: var(--accent);
    white-space: nowrap;
  }

  .nowrap {
    white-space: nowrap;
  }

  .sub {
    max-width: 40rem;
    margin: 1.5rem auto 0;
    font-size: 1.15rem;
    line-height: 1.6;
    color: var(--text-muted);
    text-wrap: pretty;
  }

  .ctas {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 2rem;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.75rem 1.3rem;
    font-size: 0.98rem;
    font-weight: 600;
    text-decoration: none;
    border-radius: var(--radius-md);
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      transform 0.15s ease;
  }

  .btn:hover {
    transform: translateY(-1px);
  }

  .btn-primary {
    color: var(--accent-text);
    background: var(--accent);
  }

  .btn-primary:hover {
    background: var(--accent-hover);
  }

  .btn-ghost {
    color: var(--text);
    border: 1px solid var(--border-strong);
    background: var(--surface);
  }

  .btn-ghost:hover {
    border-color: var(--accent);
  }

  .quick {
    max-width: 560px;
    margin: 2.5rem auto 0;
    text-align: left;
  }

  .quick :global(.quickstart) {
    margin-bottom: 0;
  }

  .quick :global(.quickstart-head) {
    display: none;
  }

  .rise {
    animation: rise 0.7s cubic-bezier(0.2, 0.7, 0.2, 1) both;
    animation-delay: var(--d, 0ms);
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(14px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .rise {
      animation: none;
    }
  }

  .how,
  .features,
  .demos {
    width: 100%;
    max-width: var(--wide);
    margin: 0 auto;
    padding: 5rem 2rem 0;
  }

  .section-head {
    max-width: 44rem;
    margin-bottom: 2.5rem;
  }

  .section-head h2 {
    font-family: var(--font-serif);
    font-size: clamp(1.8rem, 3.2vw, 2.5rem);
    font-weight: 450;
    font-variation-settings:
      'opsz' 144,
      'SOFT' 50;
    line-height: 1.1;
    letter-spacing: -0.02em;
    color: var(--text);
    text-wrap: balance;
  }

  .section-head p {
    margin-top: 0.75rem;
    font-size: 1.05rem;
    line-height: 1.6;
    color: var(--text-muted);
  }

  .text-link {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--accent);
    font-weight: 600;
    text-decoration: none;
  }

  .text-link:hover {
    text-decoration: underline;
  }

  .steps {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1.25rem;
    list-style: none;
  }

  .step {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 1.5rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
  }

  .step-head {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
  }

  .step-num {
    font-family: var(--font-serif);
    font-size: 2.6rem;
    font-weight: 400;
    font-variation-settings:
      'opsz' 144,
      'WONK' 1;
    line-height: 1;
    color: var(--accent);
  }

  .step h3 {
    font-family: var(--font-serif);
    font-size: 1.3rem;
    font-weight: 500;
    letter-spacing: -0.01em;
  }

  .step-body {
    margin: 0.75rem 0 1.25rem;
    font-size: 0.95rem;
    line-height: 1.55;
    color: var(--text-muted);
  }

  .code {
    overflow: hidden;
    background: var(--code-bg);
    border-radius: var(--radius-md);
  }

  .code-file {
    padding: 0.5rem 0.9rem;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--code-muted);
    background: var(--code-chrome-bg);
    border-bottom: 1px solid var(--code-chrome-border);
  }

  .code :global(pre) {
    margin: 0;
    padding: 0.85rem 0.9rem;
    font-size: 0.78rem;
    line-height: 1.55;
    border-radius: 0;
  }

  .figure {
    display: grid;
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
    gap: 3rem;
    align-items: center;
    margin-top: 3rem;
    padding: 2.5rem;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }

  .figure-copy h3 {
    font-family: var(--font-serif);
    font-size: 1.6rem;
    font-weight: 450;
    letter-spacing: -0.015em;
    line-height: 1.15;
  }

  .figure-copy p {
    margin: 0.75rem 0 1rem;
    color: var(--text-muted);
    line-height: 1.6;
  }

  .figure-demo :global(.islands-demo) {
    margin: 0;
  }

  .figure-demo :global(.islands-demo .box) {
    min-height: 64px;
  }

  .feature-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    list-style: none;
    border-top: 1px solid var(--border);
    border-left: 1px solid var(--border);
  }

  .feature-grid li {
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }

  .feature {
    display: block;
    height: 100%;
    padding: 1.75rem 1.5rem 2rem;
    color: inherit;
    text-decoration: none;
    transition: background 0.15s ease;
  }

  .feature:hover {
    background: var(--surface);
  }

  .feature-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    margin-bottom: 1.1rem;
    color: var(--accent-soft-text);
    background: var(--accent-soft);
    border-radius: var(--radius-md);
  }

  .feature h3 {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 0.4rem;
  }

  .feature p {
    font-size: 0.9rem;
    line-height: 1.55;
    color: var(--text-muted);
  }

  .demo-groups {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
  }

  .demo-group {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    gap: 2rem;
    padding: 2rem 0;
    border-bottom: 1px solid var(--border);
  }

  .demo-group-label {
    position: sticky;
    top: 1.5rem;
    align-self: start;
    font-family: var(--font-serif);
    font-size: 1.15rem;
    font-weight: 500;
    font-variant-caps: all-small-caps;
    font-feature-settings: 'smcp';
    letter-spacing: 0.08em;
    color: var(--text-subtle);
  }

  .demo-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .demo {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.9rem 1rem;
    color: inherit;
    text-decoration: none;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }

  .demo:hover {
    background: var(--surface);
    border-color: var(--border);
  }

  .demo-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .demo-title {
    font-weight: 600;
    font-size: 0.95rem;
  }

  .demo:hover .demo-title {
    color: var(--accent-soft-text);
  }

  .demo-icon {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--text-subtle);
  }

  .demo-hook {
    font-size: 0.82rem;
    line-height: 1.45;
    color: var(--text-subtle);
  }

  .closing {
    margin-top: 5rem;
    padding: 4.5rem 2rem;
  }

  .closing-inner {
    position: relative;
    max-width: 760px;
    margin: 0 auto;
  }

  .closing h2 {
    font-family: var(--font-serif);
    font-size: clamp(1.8rem, 3.6vw, 2.8rem);
    font-weight: 400;
    font-variation-settings:
      'opsz' 144,
      'SOFT' 50,
      'WONK' 1;
    line-height: 1.1;
    letter-spacing: -0.02em;
    color: #fff;
    text-wrap: balance;
  }

  .btn-light {
    color: #1f2a24;
    background: #f4f1e8;
  }

  .btn-light:hover {
    background: #fff;
  }

  .btn-outline-light {
    color: #f4f1e8;
    border: 1px solid rgba(244, 241, 232, 0.45);
  }

  .btn-outline-light:hover {
    border-color: #f4f1e8;
  }

  .c1 :global(.footer-inner) {
    max-width: var(--wide);
  }

  @media (max-width: 1024px) {
    .steps {
      grid-template-columns: minmax(0, 1fr);
      max-width: 640px;
    }

    .feature-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .figure {
      grid-template-columns: minmax(0, 1fr);
      gap: 1.75rem;
    }

    .demo-group {
      grid-template-columns: minmax(0, 1fr);
      gap: 0.75rem;
    }

    .demo-group-label {
      position: static;
    }

    .demo-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 640px) {
    .masthead {
      padding: 1.5rem 1rem 3rem;
    }

    .frame {
      padding: 2.25rem 1.25rem 1.75rem;
    }

    .announce {
      font-size: 0.78rem;
    }

    .sub {
      font-size: 1.02rem;
    }

    .how,
    .features,
    .demos {
      padding: 3.5rem 1rem 0;
    }

    .figure {
      padding: 1.25rem;
    }

    .feature-grid,
    .demo-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .earns {
      white-space: normal;
    }

    .closing {
      padding: 3rem 1.25rem;
    }
  }
</style>
