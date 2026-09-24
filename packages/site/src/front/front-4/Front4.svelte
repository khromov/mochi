<script lang="ts">
  import '@fontsource/public-sans/800.css';
  import '@fontsource/public-sans/900.css';
  import '@fontsource/jetbrains-mono/400.css';
  import '@fontsource/jetbrains-mono/500.css';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import FrontShell from '../FrontShell.svelte';
  import Footer from '../../components/Footer.svelte';
  import RevealIslands from './RevealIslands.svelte';
  import JsMeter from './JsMeter.svelte';
  import ScrollStory from './ScrollStory.svelte';
  import VisibleStamp from './VisibleStamp.svelte';
  import { highlightCode } from '../../lib/highlight.server';
  import { serve, page, hydrationModes, create, type CodeSample } from '../codeSamples';
  import { demoGroups, demoCount } from '../demoGroups';
  import { demoIconFor } from '../../lib/demoIcons';
  import { isExternal } from '../../lib/isExternal';
  import type { TocEntry } from '../../lib/toc';

  let { docsNav, firstDocSlug }: { docsNav: TocEntry[]; firstDocSlug: string } = $props();

  const SCRIPT_CLOSE = '<' + '/script>';

  const emitted: CodeSample = {
    file: 'Response body',
    lang: 'html',
    code: `<script type="application/json" id="mochi-props-0">[{"count":1},5]${SCRIPT_CLOSE}
<mochi-hydratable-island component-name="Counter" component-url="/_mochi/client/_hydrate-Counter.js" props-ref="mochi-props-0">
  <button>Clicked 5 times</button>
</mochi-hydratable-island>`,
  };

  const DIRECTIVE = /<span class="tok attr_name">mochi<\/span>:<span class="tok attr_name">(?:hydrate|defer)<\/span>(?::<span class="tok attr_name">visible<\/span>)?/g;
  const ISLAND_TAG = /<span class="tok tag_name">mochi-hydratable-island<\/span>/g;
  const markJs = (html: string) => html.replace(DIRECTIVE, (m) => `<mark class="js">${m}</mark>`).replace(ISLAND_TAG, (m) => `<mark class="js">${m}</mark>`);
  const highlight = async (sample: CodeSample) => markJs(await highlightCode(sample.code, sample.lang));

  const steps = [
    {
      title: 'A request hits Mochi.serve()',
      body: 'Routes map URLs to Svelte pages. A page’s serverProps load its data on the server.',
      file: serve.file,
      html: await highlight(serve),
    },
    {
      title: 'Svelte renders every component on the server',
      body: 'The whole page renders to HTML on every request — islands included, so they paint before any JavaScript arrives.',
      file: page.file,
      html: await highlight(page),
    },
    {
      title: 'Plain HTML ships',
      body: 'Static components become markup and nothing else. An island ships as HTML plus a pointer to its code and its serialized props. Names are simplified here; the real ones carry a content hash.',
      file: emitted.file,
      html: await highlight(emitted),
    },
    {
      title: 'Only islands hydrate',
      body: 'The browser loads JavaScript for the islands alone — right away, or only once they scroll into view. Server islands render after the page loads.',
      file: hydrationModes.file,
      html: await highlight(hydrationModes),
    },
  ];

  const modes = [
    { directive: 'mochi:hydrate', component: 'Counter', text: 'Hydrates on page load.', href: '/docs/selective-hydration/', live: false },
    { directive: 'mochi:hydrate:visible', component: 'HeavyChart', text: 'Hydrates when scrolled into view.', href: '/docs/lazy-hydration/', live: true },
    { directive: 'mochi:defer', component: 'UserAvatar', text: 'Renders on the server after the page loads — a server island.', href: '/docs/server-islands/', live: false },
    { directive: 'mochi:defer:visible', component: 'Comments', text: 'Fetches the server island when scrolled into view.', href: '/docs/server-islands/', live: false },
  ];

  let counter = 0;
  const indexedGroups = demoGroups.map((group) => ({
    ...group,
    rows: group.items.map((demo) => ({ demo, n: ++counter })),
  }));

  const navStyle =
    "--nav-brand-font: 'Public Sans', sans-serif; --nav-brand-weight: 800; --nav-cta-bg: var(--text); --nav-cta-text: var(--bg); --nav-cta-radius: 0; --nav-border: var(--border-strong);";
</script>

<FrontShell {docsNav} {firstDocSlug} concept={4} title="Mochi — This page is mostly HTML" style={navStyle}>
  <main class="f4">
    <section class="splash">
      <div class="masthead">
        <span>Mochi — an islands framework for Svelte 5 on Bun</span>
        <span class="legend"><span class="swatch" aria-hidden="true"></span>The only colour on this page is JavaScript.</span>
      </div>

      <h1>
        <span class="line">This page is</span>
        <span class="line">mostly HTML.</span>
      </h1>

      <div class="hero-grid">
        <div class="hero-copy">
          <p class="lede">Mochi renders every component on the server. Only islands ship JavaScript — flip the switch to see them.</p>
          <div class="start">
            <span class="start-label">Start a project</span>
            <code class="cmd">{create.code}</code>
          </div>
          <a class="docs-link" href="/docs/{firstDocSlug}/">Read the docs <ArrowRight size={18} strokeWidth={2.6} /></a>
        </div>
        <div class="hero-cell">
          <RevealIslands mochi:hydrate />
        </div>
        <div class="hero-cell">
          <JsMeter mochi:hydrate />
        </div>
      </div>
    </section>

    <section class="section">
      <header class="section-head">
        <h2>Request → HTML → islands</h2>
        <p>What happens between a request and a working page, in four steps. This walkthrough is itself an island — it hydrated when you scrolled here.</p>
      </header>
      <ScrollStory mochi:hydrate:visible {steps} />
    </section>

    <section class="section">
      <header class="section-head">
        <h2>Four ways to hydrate</h2>
        <p>An island is any component marked with a <code>mochi:*</code> directive. The directive decides when it runs.</p>
      </header>
      <div class="modes">
        {#each modes as mode (mode.directive)}
          <a class="mode" href={mode.href}>
            <code class="mode-directive"><mark>{mode.directive}</mark></code>
            <p class="mode-text">{mode.text}</p>
            <code class="mode-line">&lt;{mode.component} {mode.directive} /&gt;</code>
            {#if mode.live}
              <span class="mode-live">This card: <VisibleStamp mochi:hydrate:visible /></span>
            {/if}
          </a>
        {/each}
      </div>
    </section>

    <section class="section" id="demos">
      <header class="section-head">
        <h2>Demos</h2>
        <p>{demoCount} demos. Each one lives on its own page and shows one feature in isolation.</p>
      </header>
      {#each indexedGroups as group (group.category)}
        <div class="demo-group">
          <h3 class="demo-group-title">{group.label}<span>{group.rows.length}</span></h3>
          <ol class="demo-list">
            {#each group.rows as row (row.demo.href)}
              {@const meta = demoIconFor[row.demo.title]}
              {@const external = isExternal(row.demo.href)}
              <li>
                <a class="demo-row" href={row.demo.href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
                  <span class="demo-n">{String(row.n).padStart(2, '0')}</span>
                  <span class="demo-title"
                    >{row.demo.title}{#if external}<ArrowUpRight size={16} strokeWidth={2.4} />{/if}</span
                  >
                  <span class="demo-hook">{row.demo.hook}</span>
                  <span class="demo-icon" aria-hidden="true">
                    {#if meta}
                      {@const Icon = meta.icon}
                      <Icon size={20} strokeWidth={1.8} />
                    {/if}
                  </span>
                </a>
              </li>
            {/each}
          </ol>
        </div>
      {/each}
    </section>
  </main>

  <Footer />
</FrontShell>

<style>
  :global(body:has(.f4)) {
    --bg: #fff;
    --surface: #fff;
    --surface-muted: #f4f4f4;
    --border: #e4e4e4;
    --border-strong: #0a0a0a;
    --text: #0a0a0a;
    --text-muted: #525252;
    --text-subtle: #737373;
    --accent: #0a0a0a;
    --accent-hover: #000;
    --accent-text: #fff;
    --accent-soft: #f0f0f0;
    --accent-soft-text: #0a0a0a;
    --focus-ring: 0 0 0 3px rgba(247, 223, 30, 0.8);
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light']) body:has(.f4)) {
      --bg: #0a0a0a;
      --surface: #0a0a0a;
      --surface-muted: #141414;
      --border: #262626;
      --border-strong: #f5f5f5;
      --text: #f5f5f5;
      --text-muted: #a3a3a3;
      --text-subtle: #8a8a8a;
      --accent: #f5f5f5;
      --accent-hover: #fff;
      --accent-text: #0a0a0a;
      --accent-soft: #1c1c1c;
      --accent-soft-text: #f5f5f5;
    }
  }

  :global([data-theme='dark'] body:has(.f4)) {
    --bg: #0a0a0a;
    --surface: #0a0a0a;
    --surface-muted: #141414;
    --border: #262626;
    --border-strong: #f5f5f5;
    --text: #f5f5f5;
    --text-muted: #a3a3a3;
    --text-subtle: #8a8a8a;
    --accent: #f5f5f5;
    --accent-hover: #fff;
    --accent-text: #0a0a0a;
    --accent-soft: #1c1c1c;
    --accent-soft-text: #f5f5f5;
  }

  :global(body:has(.f4) .banner) {
    background: var(--text);
    color: var(--bg);
    border-bottom: 0;
    box-shadow: none;
  }

  :global(body:has(.f4) .banner .banner-text strong),
  :global(body:has(.f4) .banner .banner-link),
  :global(body:has(.f4) .banner .banner-icon) {
    color: inherit;
    text-decoration-color: currentColor;
  }

  :global(body:has(.f4) .footer),
  :global(body:has(.f4) .topnav .brand),
  :global(body:has(.f4) .mobile-brand) {
    filter: grayscale(1);
  }

  :global(html.reveal-islands mochi-hydratable-island:not([component-name^='CodeBlockCopy']) > *) {
    outline: 3px solid #f7df1e !important;
    outline-offset: 3px;
    box-shadow: inset 0 0 0 100vmax rgba(247, 223, 30, 0.28) !important;
  }

  @keyframes -global-f4-rise {
    from {
      opacity: 0;
      transform: translateY(0.25em);
    }
  }

  @keyframes -global-f4-fade {
    from {
      opacity: 0;
    }
  }

  .f4 {
    --ink: #0a0a0a;
    --paper: #fff;
    --hair: #e4e4e4;
    --mute: #525252;
    --js: #f7df1e;
    --code-paper: #f4f4f4;
    --code-ink: #0a0a0a;
    --code-mute: #767676;
    --code-soft: #3f3f3f;
    --pad: clamp(1.25rem, 4vw, 3rem);
    --mono: 'JetBrains Mono', ui-monospace, monospace;
    flex: 1;
    padding-bottom: clamp(4rem, 8vw, 7rem);
    background: var(--paper);
    color: var(--ink);
    font-family: 'Public Sans', sans-serif;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .f4 {
      --ink: #f5f5f5;
      --paper: #0a0a0a;
      --hair: #262626;
      --mute: #a3a3a3;
      --code-paper: #141414;
      --code-ink: #ededed;
      --code-mute: #8a8a8a;
      --code-soft: #c4c4c4;
    }
  }

  :global([data-theme='dark']) .f4 {
    --ink: #f5f5f5;
    --paper: #0a0a0a;
    --hair: #262626;
    --mute: #a3a3a3;
    --code-paper: #141414;
    --code-ink: #ededed;
    --code-mute: #8a8a8a;
    --code-soft: #c4c4c4;
  }

  .f4 mark {
    background: var(--js);
    color: #0a0a0a;
    padding: 0.05em 0.25em;
  }

  .f4 code {
    font-family: var(--mono);
    font-size: 0.9em;
  }

  .f4 :global(pre) {
    margin: 0;
    padding: 1.1rem 1.25rem;
    background: var(--code-paper);
    color: var(--code-ink);
    border: 1px solid var(--ink);
    border-radius: 0;
    font-family: var(--mono);
    font-size: 0.82rem;
    line-height: 1.7;
  }

  .f4 :global(.twinkleplop .tok) {
    color: var(--code-ink);
    font-style: normal;
  }

  .f4 :global(.twinkleplop .tok.comment) {
    color: var(--code-mute);
    font-style: italic;
  }

  .f4 :global(.twinkleplop .tok.punctuation),
  .f4 :global(.twinkleplop .tok.operator),
  .f4 :global(.twinkleplop .tok.expression) {
    color: var(--code-mute);
  }

  .f4 :global(.twinkleplop .tok.string),
  .f4 :global(.twinkleplop .tok.template),
  .f4 :global(.twinkleplop .tok.number) {
    color: var(--code-soft);
  }

  .f4 :global(.twinkleplop .tok.keyword),
  .f4 :global(.twinkleplop .tok.tag_name),
  .f4 :global(.twinkleplop .tok.function) {
    font-weight: 500;
  }

  .f4 :global(.twinkleplop mark.js) {
    padding: 0.08em 0.2em;
    margin: 0 -0.2em;
    background: var(--js);
  }

  .f4 :global(.twinkleplop mark.js .tok) {
    color: #0a0a0a;
  }

  .f4 :global(.code-copy) {
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--ink);
    border-radius: 0;
  }

  .f4 :global(.code-copy:hover) {
    color: #0a0a0a;
    background: var(--js);
    border-color: #0a0a0a;
  }

  .splash {
    padding: clamp(1.5rem, 3vw, 2.5rem) var(--pad) 0;
  }

  .masthead {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem 1.5rem;
    flex-wrap: wrap;
    padding-bottom: 0.9rem;
    border-bottom: 1px solid var(--ink);
    font-size: 0.9rem;
    font-weight: 600;
    animation: f4-fade 0.6s ease backwards;
  }

  .legend {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
  }

  .swatch {
    width: 0.9rem;
    height: 0.9rem;
    background: var(--js);
    outline: 1px solid var(--ink);
  }

  h1 {
    margin: clamp(1.5rem, 4vw, 3.25rem) 0 clamp(1.75rem, 4vw, 3rem) -0.045em;
    font-size: clamp(2.9rem, 11.5vw, 11rem);
    font-weight: 900;
    line-height: 0.9;
    letter-spacing: -0.06em;
  }

  .line {
    display: block;
    animation: f4-rise 0.7s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  }

  .line + .line {
    animation-delay: 0.09s;
  }

  .hero-grid {
    display: grid;
    grid-template-columns: minmax(0, 5fr) minmax(0, 4fr) minmax(0, 4fr);
    border-top: 6px solid var(--ink);
    animation: f4-fade 0.8s 0.2s ease backwards;
  }

  .hero-grid > * {
    padding: 1.75rem 2rem 2.5rem;
    border-left: 1px solid var(--ink);
  }

  .hero-grid > :first-child {
    padding-left: 0;
    border-left: 0;
  }

  .hero-grid > :last-child {
    padding-right: 0;
  }

  .lede {
    max-width: 30ch;
    font-size: clamp(1.15rem, 1.6vw, 1.45rem);
    font-weight: 600;
    line-height: 1.32;
    letter-spacing: -0.012em;
  }

  .start {
    display: grid;
    gap: 0.45rem;
    margin-top: 1.75rem;
  }

  .start-label {
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .cmd {
    width: fit-content;
    max-width: 100%;
    padding: 0.7rem 0.95rem;
    font-size: 1rem;
    color: var(--paper);
    background: var(--ink);
    user-select: all;
    overflow-wrap: anywhere;
  }

  .docs-link {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    margin-top: 1.5rem;
    padding-bottom: 0.15rem;
    font-size: 1.05rem;
    font-weight: 800;
    color: var(--ink);
    text-decoration: none;
    border-bottom: 3px solid var(--ink);
  }

  .docs-link:hover {
    gap: 0.7rem;
  }

  .section {
    padding: clamp(4rem, 8vw, 7rem) var(--pad) 0;
  }

  .section-head {
    display: grid;
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
    gap: 1rem 2rem;
    align-items: end;
    margin-bottom: clamp(1.75rem, 3vw, 2.75rem);
    padding-top: 1.1rem;
    border-top: 6px solid var(--ink);
  }

  .section-head h2 {
    font-size: clamp(2.2rem, 5.2vw, 4.75rem);
    font-weight: 900;
    line-height: 0.92;
    letter-spacing: -0.05em;
  }

  .section-head p {
    max-width: 48ch;
    font-size: 1.05rem;
    line-height: 1.5;
    color: var(--mute);
  }

  .f4 :global(.story) {
    display: grid;
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  }

  .f4 :global(.story-steps) {
    list-style: none;
    border-right: 1px solid var(--ink);
  }

  .f4 :global(.story-step) {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr);
    gap: 0 0.5rem;
    min-height: 62vh;
    padding: 2rem 2.5rem 2rem 0;
    border-top: 1px solid var(--hair);
    opacity: 0.4;
    transition: opacity 0.35s ease;
  }

  .f4 :global(.story-step:first-child) {
    border-top: 0;
  }

  .f4 :global(.story-step.active) {
    opacity: 1;
  }

  .f4 :global(.story-num) {
    width: fit-content;
    height: fit-content;
    padding: 0 0.1em;
    font-size: 3.25rem;
    font-weight: 900;
    line-height: 0.95;
    letter-spacing: -0.05em;
    transition: background 0.2s ease;
  }

  .f4 :global(.story-live .story-step.active .story-num) {
    background: var(--js);
    color: #0a0a0a;
  }

  .f4 :global(.story-text h3) {
    margin-bottom: 0.75rem;
    font-size: clamp(1.4rem, 2.2vw, 2rem);
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: -0.03em;
  }

  .f4 :global(.story-text p) {
    max-width: 40ch;
    font-size: 1rem;
    line-height: 1.55;
    color: var(--mute);
  }

  .f4 :global(.story-panel) {
    position: sticky;
    top: 1.5rem;
    align-self: start;
    margin: 2rem 0 2rem 2.5rem;
  }

  .f4 :global(.story-panel-head),
  .f4 :global(.story-file) {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.55rem 0.9rem;
    font-family: var(--mono);
    font-size: 0.75rem;
    color: var(--paper);
    background: var(--ink);
  }

  .f4 :global(.story-code) {
    animation: f4-fade 0.35s ease;
  }

  .f4 :global(.story-code pre) {
    min-height: 21rem;
    border-top: 0;
  }

  .f4 :global(.story-inline) {
    display: none;
  }

  .f4 :global(.story-inline pre) {
    border-top: 0;
  }

  .modes {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-top: 1px solid var(--ink);
    border-bottom: 1px solid var(--ink);
  }

  .mode {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-height: 17rem;
    padding: 1.5rem 1.5rem 1.75rem;
    color: inherit;
    text-decoration: none;
    border-left: 1px solid var(--ink);
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }

  .mode:first-child {
    border-left: 0;
  }

  .mode:hover {
    background: var(--ink);
    color: var(--paper);
  }

  .mode-directive {
    font-size: 0.95rem;
    font-weight: 500;
  }

  .mode-text {
    flex: 1;
    font-size: 1.1rem;
    font-weight: 700;
    line-height: 1.3;
    letter-spacing: -0.015em;
  }

  .mode-line {
    font-size: 0.78rem;
    color: var(--mute);
  }

  .mode:hover .mode-line {
    color: inherit;
  }

  .mode-live {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    font-family: var(--mono);
    font-size: 0.75rem;
  }

  .f4 :global(.stamp) {
    padding: 0 0.3em;
    outline: 1px dashed currentColor;
  }

  .f4 :global(.stamp-on) {
    color: #0a0a0a;
    background: var(--js);
    outline: 0;
  }

  .demo-group + .demo-group {
    margin-top: 2.75rem;
  }

  .demo-group-title {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding-bottom: 0.6rem;
    font-size: 1.1rem;
    font-weight: 800;
    letter-spacing: -0.01em;
    border-bottom: 3px solid var(--ink);
  }

  .demo-group-title span {
    font-family: var(--mono);
    font-size: 0.85rem;
    font-weight: 400;
    color: var(--mute);
  }

  .demo-list {
    list-style: none;
  }

  .demo-row {
    display: grid;
    grid-template-columns: 4.25rem minmax(0, 1fr) minmax(0, 1.6fr) 1.5rem;
    gap: 1.5rem;
    align-items: baseline;
    padding: 1.05rem 0.75rem;
    color: inherit;
    text-decoration: none;
    border-bottom: 1px solid var(--hair);
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }

  .demo-row:hover {
    background: var(--ink);
    color: var(--paper);
  }

  .demo-n {
    font-size: 1.9rem;
    font-weight: 900;
    line-height: 1;
    letter-spacing: -0.045em;
  }

  .demo-title {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 1.1rem;
    font-weight: 800;
    letter-spacing: -0.015em;
  }

  .demo-hook {
    font-size: 0.92rem;
    line-height: 1.45;
    color: var(--mute);
  }

  .demo-row:hover .demo-hook {
    color: inherit;
    opacity: 0.75;
  }

  .demo-icon {
    display: inline-flex;
    align-self: center;
    justify-self: end;
  }

  @media (max-width: 1100px) {
    .hero-grid {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }

    .hero-copy {
      grid-column: 1 / -1;
      padding-right: 0;
      border-bottom: 1px solid var(--ink);
    }

    .hero-grid > :nth-child(2) {
      padding-left: 0;
      border-left: 0;
    }

    .modes {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .mode:nth-child(3) {
      border-left: 0;
    }

    .mode:nth-child(n + 3) {
      border-top: 1px solid var(--ink);
    }
  }

  @media (max-width: 900px) {
    .f4 :global(.story) {
      grid-template-columns: minmax(0, 1fr);
    }

    .f4 :global(.story-steps) {
      border-right: 0;
    }

    .f4 :global(.story-step) {
      grid-template-columns: 3.25rem minmax(0, 1fr);
      min-height: 0;
      padding: 1.75rem 0;
      opacity: 1;
    }

    .f4 :global(.story-num) {
      font-size: 2.25rem;
    }

    .f4 :global(.story-panel) {
      display: none;
    }

    .f4 :global(.story-inline) {
      display: block;
      margin-top: 1.1rem;
    }
  }

  @media (max-width: 760px) {
    .demo-row {
      grid-template-columns: 2.75rem minmax(0, 1fr);
      gap: 0.25rem 1rem;
      padding: 0.95rem 0.25rem;
    }

    .demo-hook {
      grid-column: 2;
    }

    .demo-icon {
      display: none;
    }

    .demo-n {
      font-size: 1.4rem;
    }
  }

  @media (max-width: 640px) {
    .hero-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .hero-grid > * {
      padding: 1.5rem 0 1.75rem;
      border-left: 0;
    }

    .hero-grid > * + * {
      border-top: 1px solid var(--ink);
    }

    .hero-copy {
      border-bottom: 0;
    }

    .section-head {
      grid-template-columns: minmax(0, 1fr);
    }

    .modes {
      grid-template-columns: minmax(0, 1fr);
    }

    .mode {
      min-height: 0;
      border-left: 0;
    }

    .mode + .mode {
      border-top: 1px solid var(--ink);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .line,
    .masthead,
    .hero-grid,
    .f4 :global(.story-code) {
      animation: none;
    }

    .f4 :global(.story-step) {
      transition: none;
    }
  }
</style>
