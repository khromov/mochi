<script lang="ts">
  import { Image } from 'mochi-framework/image';
  import MousePointerClick from '@lucide/svelte/icons/mouse-pointer-click';
  import Code from '@lucide/svelte/icons/code';
  import Zap from '@lucide/svelte/icons/zap';
  import Radio from '@lucide/svelte/icons/radio';
  import Send from '@lucide/svelte/icons/send';
  import Eye from '@lucide/svelte/icons/eye';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import FrontShell from '../FrontShell.svelte';
  import Footer from '../../components/Footer.svelte';
  import ImageCredits from '../../components/ImageCredits.svelte';
  import Dango from './Dango.svelte';
  import CopyCommand from './CopyCommand.svelte';
  import SquishCounter from './SquishCounter.svelte';
  import VisibleStamp from './VisibleStamp.svelte';
  import { demoGroups, demoCount } from '../demoGroups';
  import { page, sse, loginForm } from '../codeSamples';
  import { demoIconFor } from '../../lib/demoIcons';
  import { isExternal } from '../../lib/isExternal';
  import { highlightCode } from '../../lib/highlight.server';
  import type { TocEntry } from '../../lib/toc';

  let { docsNav, firstDocSlug }: { docsNav: TocEntry[]; firstDocSlug: string } = $props();

  const pageHtml = await highlightCode(page.code, page.lang);
  const sseHtml = await highlightCode(sse.code, sse.lang);
  const formHtml = await highlightCode(loginForm.code, loginForm.lang);

  const photo = 'https://sta-public.fra1.cdn.digitaloceanspaces.com/mochi/mochi-11.jpg';
</script>

<FrontShell {docsNav} {firstDocSlug} concept={3} title="Mochi — Soft to write. Light to ship.">
  <div class="f3">
    <section class="masthead">
      <div class="hero-inner">
        <div class="hero-copy">
          <h1 class="pop" style="--i: 0">
            <span class="line">Soft to write.</span>
            <span class="line line-matcha">Light to ship.</span>
          </h1>
          <p class="sub pop" style="--i: 1">
            Mochi is an islands framework for Svelte 5 on Bun. Pages render to plain HTML; only the components you mark as islands ship JavaScript.
          </p>
          <div class="actions pop" style="--i: 2">
            <a class="squish squish-primary" href="/docs/{firstDocSlug}/">Get started <ArrowRight size={18} strokeWidth={2.4} /></a>
            <a class="squish squish-secondary" href="#demos">See the demos</a>
          </div>
          <div class="hero-command pop" style="--i: 3">
            <CopyCommand mochi:hydrate />
          </div>
        </div>

        <div class="hero-art pop" style="--i: 1">
          <span class="shape shape-matcha" aria-hidden="true"></span>
          <span class="shape shape-kinako" aria-hidden="true"></span>
          <span class="shape shape-ring" aria-hidden="true"></span>
          <div class="photo">
            <Image src={photo} size="hero" alt="Three white mochi, one cut open to show a matcha filling, on a blue plate" />
          </div>
          <span class="float float-a"><Dango size={150} /></span>
          <span class="float float-b"><Dango size={96} /></span>
          <span class="tag">Zero JS<br />by default</span>
        </div>
      </div>
    </section>

    <section class="bento-section" aria-labelledby="f3-inside">
      <svg class="wave" viewBox="0 0 1440 64" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 32 C 180 0 360 64 540 32 C 720 0 900 64 1080 32 C 1260 0 1350 48 1440 32 V64 H0 Z" />
      </svg>
      <div class="section-inner">
        <header class="section-head">
          <h2 id="f3-inside">What's inside</h2>
          <p>Everything renders on the server. A few things wake up in the browser.</p>
        </header>

        <div class="bento">
          <article class="tile tile-island">
            <div class="tile-head">
              <span class="tile-icon"><MousePointerClick size={18} strokeWidth={2} /></span>
              <h3>Islands</h3>
            </div>
            <p class="tile-text">This button is an island. The tiles around it ship no JavaScript.</p>
            <div class="tile-demo">
              <SquishCounter mochi:hydrate />
            </div>
            <code class="tile-directive">&lt;SquishCounter mochi:hydrate /&gt;</code>
          </article>

          <article class="tile tile-code">
            <div class="tile-head">
              <span class="tile-icon"><Code size={18} strokeWidth={2} /></span>
              <h3>It's just Svelte</h3>
            </div>
            <p class="tile-text">A page is a Svelte 5 component. Mark the interactive parts; the rest stays HTML.</p>
            <div class="tile-snippet">
              <span class="snippet-file">{page.file}</span>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html pageHtml}
            </div>
          </article>

          <article class="tile tile-bun">
            <div class="tile-head">
              <span class="tile-icon"><Zap size={18} strokeWidth={2} /></span>
              <h3>No Vite, just Bun</h3>
            </div>
            <p class="tile-text">Bun's bundler builds sites with hundreds of routes in seconds.</p>
            <span class="tile-dango" aria-hidden="true"><Dango size={92} /></span>
          </article>

          <article class="tile tile-realtime">
            <div class="tile-head">
              <span class="tile-icon"><Radio size={18} strokeWidth={2} /></span>
              <h3>Real-time built in</h3>
            </div>
            <p class="tile-text">WebSockets and Server-Sent Events are route types: <code>Mochi.ws()</code> and <code>Mochi.sse()</code>.</p>
            <div class="tile-snippet tile-snippet-small">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html sseHtml}
            </div>
          </article>

          <article class="tile tile-forms">
            <div class="tile-head">
              <span class="tile-icon"><Send size={18} strokeWidth={2} /></span>
              <h3>Forms that work without JS</h3>
            </div>
            <p class="tile-text">Page actions handle plain HTML form POSTs. Add <code>enhance()</code> when you want it.</p>
            <div class="tile-snippet tile-snippet-small">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html formHtml}
            </div>
          </article>

          <article class="tile tile-visible">
            <div class="tile-visible-copy">
              <div class="tile-head">
                <span class="tile-icon"><Eye size={18} strokeWidth={2} /></span>
                <h3>Hydrates when you get here</h3>
              </div>
              <p class="tile-text">
                <code>mochi:hydrate:visible</code> waits until an island scrolls into view before fetching its JavaScript and CSS.
              </p>
            </div>
            <div class="tile-visible-stamp">
              <VisibleStamp mochi:hydrate:visible />
            </div>
          </article>
        </div>
      </div>
    </section>

    <section class="demos" id="demos" aria-labelledby="f3-demos">
      <div class="section-inner">
        <header class="section-head">
          <h2 id="f3-demos">Take a bite</h2>
          <p>{demoCount} demos, each on its own page. Pick one and see a feature on its own.</p>
        </header>

        {#each demoGroups as group (group.category)}
          <section class="demo-group demo-{group.category}" aria-labelledby="f3-group-{group.category}">
            <h3 class="group-title" id="f3-group-{group.category}">
              <span class="group-dots" aria-hidden="true"><span></span><span></span><span></span></span>
              {group.label}
            </h3>
            <div class="stickers">
              {#each group.items as demo (demo.href)}
                {@const external = isExternal(demo.href)}
                {@const meta = demoIconFor[demo.title]}
                <a class="sticker" href={demo.href} target={external ? '_blank' : undefined} rel={external ? 'noopener' : undefined}>
                  <span class="sticker-head">
                    {#if meta}
                      {@const Icon = meta.icon}
                      <span class="sticker-icon" title={meta.label} aria-hidden="true"><Icon size={16} strokeWidth={2} /></span>
                    {/if}
                    <span class="sticker-title">{demo.title}</span>
                    {#if external}
                      <ArrowUpRight class="sticker-ext" size={15} strokeWidth={2} aria-hidden="true" />
                    {/if}
                  </span>
                  <span class="sticker-hook">{demo.hook}</span>
                </a>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    </section>

    <section class="closing" aria-labelledby="f3-cta">
      <div class="section-inner">
        <div class="cta-card">
          <span class="cta-dango cta-dango-left" aria-hidden="true"><Dango size={130} /></span>
          <span class="cta-dango cta-dango-right" aria-hidden="true"><Dango size={100} /></span>
          <h2 id="f3-cta">Make your first Mochi app</h2>
          <p>One command scaffolds a project. Requires Bun 1.4.0 or newer.</p>
          <div class="cta-command">
            <CopyCommand mochi:hydrate />
          </div>
          <a class="cta-docs" href="/docs/{firstDocSlug}/">Or read the docs first <ArrowRight size={16} strokeWidth={2.2} /></a>
        </div>
        <div class="credits">
          <ImageCredits />
        </div>
      </div>
    </section>
  </div>

  <Footer />
</FrontShell>

<style>
  :global(.front:has(.f3)) {
    --bg: #f7d6dc;
    --surface: #fffaf5;
    --surface-muted: #fdf0ee;
    --border: rgba(59, 31, 36, 0.12);
    --border-strong: rgba(59, 31, 36, 0.24);
    --text: #3b1f24;
    --text-muted: #6b4a4f;
    --text-subtle: #8a686d;
    --accent: #5d7d3f;
    --accent-hover: #4b6832;
    --accent-text: #fffaf5;
    --accent-soft: #e3edd6;
    --accent-soft-text: #3f5a28;
    --focus-ring: 0 0 0 3px rgba(93, 125, 63, 0.3);
    --nav-border: rgba(59, 31, 36, 0.1);
    --nav-cta-bg: #3b1f24;
    --nav-cta-text: #fffaf5;
    --nav-cta-radius: 12px;
    --nav-brand-weight: 650;
  }

  .f3 {
    --f3-primary-bg: #3b1f24;
    --f3-primary-fg: #fffaf5;
    --f3-primary-shadow: #1f0f12;
    --f3-sakura: #f7d6dc;
    --f3-sakura-deep: #e39aab;
    --f3-matcha: #a8c686;
    --f3-matcha-deep: #5d7d3f;
    --f3-on-matcha: #22300f;
    --f3-rice: #fffaf5;
    --f3-kinako: #e8c872;
    --f3-ink: #3b1f24;
    --f3-ink-soft: #6b4a4f;
    --f3-choc: #2e1b1e;
    --f3-hero-bg: #f7d6dc;
    --f3-bento-bg: #dfeacf;
    --f3-card: #fffaf5;
    --f3-card-shadow: #e39aab;
    --f3-line: rgba(59, 31, 36, 0.12);
    --f3-sticker-shadow: rgba(59, 31, 36, 0.14);
    --f3-cat-hydration: #fde6eb;
    --f3-cat-data: #e8f1dc;
    --f3-cat-endpoints: #f9edc6;
    --f3-cat-forms: #dcebf6;
    --f3-cat-errors: #fbdfcf;
    --f3-cat-sites: #e9e1fa;
    --dango-stick: #d8b27c;
    --dango-1: #f2a3b5;
    --dango-2: #fffaf5;
    --dango-3: #a8c686;

    font-family: var(--font-sans);
    color: var(--f3-ink);
    overflow-x: clip;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light']) .front:has(.f3)) {
      --bg: #1d1315;
      --surface: #2a1c1f;
      --surface-muted: #241719;
      --border: rgba(247, 232, 234, 0.1);
      --border-strong: rgba(247, 232, 234, 0.2);
      --text: #f7e8ea;
      --text-muted: #d4b9bd;
      --text-subtle: #a88c91;
      --accent: #a8c686;
      --accent-hover: #bfd8a2;
      --accent-text: #1d1315;
      --accent-soft: #2c3522;
      --accent-soft-text: #cfe2b8;
      --focus-ring: 0 0 0 3px rgba(168, 198, 134, 0.3);
      --nav-border: rgba(247, 232, 234, 0.08);
      --nav-cta-bg: #f7d6dc;
      --nav-cta-text: #3b1f24;
    }

    :global(:root:not([data-theme='light'])) .f3 {
      --f3-primary-bg: #f7d6dc;
      --f3-primary-fg: #3b1f24;
      --f3-primary-shadow: #b8687b;
      --f3-ink: #f7e8ea;
      --f3-ink-soft: #d4b9bd;
      --f3-choc: #140c0e;
      --f3-hero-bg: #1d1315;
      --f3-bento-bg: #171c12;
      --f3-card: #2a1c1f;
      --f3-card-shadow: #0f0809;
      --f3-line: rgba(247, 232, 234, 0.12);
      --f3-sticker-shadow: rgba(0, 0, 0, 0.45);
      --f3-cat-hydration: #3a2228;
      --f3-cat-data: #263021;
      --f3-cat-endpoints: #36301d;
      --f3-cat-forms: #1f2b37;
      --f3-cat-errors: #3a271e;
      --f3-cat-sites: #2c2640;
      --dango-2: #f3e7e3;
    }
  }

  :global([data-theme='dark'] .front:has(.f3)) {
    --bg: #1d1315;
    --surface: #2a1c1f;
    --surface-muted: #241719;
    --border: rgba(247, 232, 234, 0.1);
    --border-strong: rgba(247, 232, 234, 0.2);
    --text: #f7e8ea;
    --text-muted: #d4b9bd;
    --text-subtle: #a88c91;
    --accent: #a8c686;
    --accent-hover: #bfd8a2;
    --accent-text: #1d1315;
    --accent-soft: #2c3522;
    --accent-soft-text: #cfe2b8;
    --focus-ring: 0 0 0 3px rgba(168, 198, 134, 0.3);
    --nav-border: rgba(247, 232, 234, 0.08);
    --nav-cta-bg: #f7d6dc;
    --nav-cta-text: #3b1f24;
  }

  :global([data-theme='dark']) .f3 {
    --f3-primary-bg: #f7d6dc;
    --f3-primary-fg: #3b1f24;
    --f3-primary-shadow: #b8687b;
    --f3-ink: #f7e8ea;
    --f3-ink-soft: #d4b9bd;
    --f3-choc: #140c0e;
    --f3-hero-bg: #1d1315;
    --f3-bento-bg: #171c12;
    --f3-card: #2a1c1f;
    --f3-card-shadow: #0f0809;
    --f3-line: rgba(247, 232, 234, 0.12);
    --f3-sticker-shadow: rgba(0, 0, 0, 0.45);
    --f3-cat-hydration: #3a2228;
    --f3-cat-data: #263021;
    --f3-cat-endpoints: #36301d;
    --f3-cat-forms: #1f2b37;
    --f3-cat-errors: #3a271e;
    --f3-cat-sites: #2c2640;
    --dango-2: #f3e7e3;
  }

  .section-inner {
    position: relative;
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 2rem;
  }

  h1,
  h2,
  h3 {
    font-family: var(--font-serif);
    font-variation-settings:
      'opsz' 144,
      'SOFT' 100,
      'WONK' 1;
    color: var(--f3-ink);
  }

  .masthead {
    position: relative;
    background: var(--f3-hero-bg);
    padding: 4.5rem 0 6.5rem;
  }

  .hero-inner {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
    align-items: center;
    gap: 3rem;
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 2rem;
  }

  h1 {
    display: flex;
    flex-direction: column;
    font-size: clamp(3rem, 7.2vw, 6.4rem);
    font-weight: 780;
    line-height: 0.94;
    letter-spacing: -0.035em;
    margin-bottom: 1.6rem;
  }

  .line-matcha {
    color: var(--f3-matcha-deep);
  }

  .sub {
    max-width: 34rem;
    font-size: 1.18rem;
    line-height: 1.6;
    color: var(--f3-ink-soft);
    margin-bottom: 2rem;
    text-wrap: pretty;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.9rem;
    margin-bottom: 1.75rem;
  }

  .squish {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.95rem 1.45rem;
    font-size: 1.02rem;
    font-weight: 700;
    line-height: 1;
    text-decoration: none;
    border-radius: 18px;
    transition:
      transform 0.12s ease,
      box-shadow 0.12s ease;
  }

  .squish-primary {
    color: var(--f3-primary-fg);
    background: var(--f3-primary-bg);
    box-shadow: 0 6px 0 var(--f3-primary-shadow);
  }

  .squish-secondary {
    color: #3b1f24;
    background: var(--f3-rice);
    box-shadow: 0 6px 0 var(--f3-sakura-deep);
  }

  .squish:hover {
    transform: translateY(-2px);
  }

  .squish-primary:hover {
    box-shadow: 0 8px 0 var(--f3-primary-shadow);
  }

  .squish-secondary:hover {
    box-shadow: 0 8px 0 var(--f3-sakura-deep);
  }

  .squish:active {
    transform: translateY(5px) scale(1.03, 0.95);
  }

  .squish-primary:active {
    box-shadow: 0 1px 0 var(--f3-primary-shadow);
  }

  .squish-secondary:active {
    box-shadow: 0 1px 0 var(--f3-sakura-deep);
  }

  .squish:focus-visible {
    outline: 3px solid var(--f3-matcha-deep);
    outline-offset: 3px;
  }

  .hero-art {
    position: relative;
    justify-self: center;
    width: min(100%, 470px);
    aspect-ratio: 1;
  }

  .photo {
    position: absolute;
    inset: 6%;
    z-index: 2;
    overflow: hidden;
    border-radius: 44% 56% 52% 48% / 50% 44% 56% 50%;
    background: var(--f3-rice);
    box-shadow:
      0 0 0 10px var(--f3-rice),
      0 26px 50px rgba(59, 31, 36, 0.18);
    animation: blob 14s ease-in-out infinite alternate;
  }

  .photo :global(img) {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 58%;
  }

  .shape {
    position: absolute;
    border-radius: 50%;
  }

  .shape-matcha {
    z-index: 1;
    right: -6%;
    bottom: 2%;
    width: 46%;
    aspect-ratio: 1;
    background: var(--f3-matcha);
  }

  .shape-kinako {
    z-index: 3;
    left: -2%;
    top: 4%;
    width: 17%;
    aspect-ratio: 1;
    background: var(--f3-kinako);
  }

  .shape-ring {
    z-index: 1;
    left: -10%;
    bottom: 8%;
    width: 30%;
    aspect-ratio: 1;
    border: 14px solid var(--f3-sakura-deep);
    opacity: 0.55;
  }

  .float {
    position: absolute;
    z-index: 4;
    filter: drop-shadow(0 10px 12px rgba(59, 31, 36, 0.18));
    animation: bob 5s ease-in-out infinite;
  }

  .float-a {
    right: -4%;
    top: -6%;
    rotate: 24deg;
  }

  .float-b {
    left: 4%;
    bottom: -6%;
    rotate: -32deg;
    animation-delay: -2.2s;
  }

  .tag {
    position: absolute;
    z-index: 5;
    right: 2%;
    bottom: 14%;
    padding: 0.7rem 0.95rem;
    font-family: var(--font-serif);
    font-variation-settings:
      'opsz' 144,
      'SOFT' 100,
      'WONK' 1;
    font-weight: 700;
    font-size: 1.05rem;
    line-height: 1.05;
    text-align: center;
    color: #3b1f24;
    background: var(--f3-kinako);
    border-radius: 20px;
    rotate: -8deg;
    box-shadow: 0 5px 0 #b8953f;
  }

  .bento-section {
    position: relative;
    background: var(--f3-bento-bg);
    padding: 3.5rem 0 5rem;
  }

  .wave {
    position: absolute;
    left: 0;
    top: -63px;
    width: 100%;
    height: 64px;
    fill: var(--f3-bento-bg);
  }

  .section-head {
    max-width: 40rem;
    margin-bottom: 2.25rem;
  }

  .section-head h2 {
    font-size: clamp(2.2rem, 4.5vw, 3.4rem);
    font-weight: 760;
    line-height: 1;
    letter-spacing: -0.03em;
    margin-bottom: 0.7rem;
  }

  .section-head p {
    font-size: 1.1rem;
    color: var(--f3-ink-soft);
  }

  .bento {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 1.1rem;
  }

  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: 0;
    padding: 1.6rem;
    background: var(--f3-card);
    border-radius: 30px;
    box-shadow: 0 6px 0 var(--f3-line);
    overflow: hidden;
  }

  .tile-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .tile-icon {
    display: inline-grid;
    place-items: center;
    width: 34px;
    height: 34px;
    flex: none;
    border-radius: 12px;
    color: #3b1f24;
    background: var(--f3-sakura);
  }

  .tile h3 {
    font-size: 1.45rem;
    font-weight: 720;
    line-height: 1.1;
    letter-spacing: -0.015em;
  }

  .tile-text {
    font-size: 0.98rem;
    line-height: 1.55;
    color: var(--f3-ink-soft);
  }

  .tile-text code,
  .tile-directive {
    font-family: var(--font-mono);
    font-size: 0.85em;
    padding: 0.1rem 0.4rem;
    border-radius: 7px;
    background: var(--f3-line);
    color: var(--f3-ink);
  }

  .tile-island {
    grid-column: span 3;
    align-items: flex-start;
    background: radial-gradient(circle at 80% 110%, rgba(247, 214, 220, 0.9) 0%, rgba(247, 214, 220, 0) 55%), var(--f3-card);
  }

  .tile-demo {
    align-self: center;
    margin: 1.25rem 0 0.75rem;
  }

  .tile-directive {
    align-self: center;
    font-size: 0.85rem;
  }

  .tile-code {
    grid-column: span 3;
    background: var(--f3-choc);
    box-shadow: 0 6px 0 rgba(0, 0, 0, 0.25);
  }

  .tile-code h3 {
    color: #fffaf5;
  }

  .tile-code .tile-text {
    color: rgba(255, 250, 245, 0.72);
  }

  .tile-code .tile-icon {
    background: var(--f3-matcha);
    color: var(--f3-on-matcha);
  }

  .tile-snippet {
    position: relative;
    min-width: 0;
    margin-top: 0.25rem;
  }

  .tile-snippet :global(pre) {
    margin: 0;
    padding: 1.1rem 1.2rem;
    font-size: 0.82rem;
    line-height: 1.6;
    border-radius: 20px;
  }

  .tile-code .tile-snippet :global(pre) {
    background: rgba(255, 255, 255, 0.05);
    padding-top: 2.1rem;
  }

  .snippet-file {
    position: absolute;
    top: 0.75rem;
    left: 1.2rem;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: rgba(255, 250, 245, 0.5);
  }

  .tile-snippet-small :global(pre) {
    font-size: 0.76rem;
    background: var(--f3-choc);
  }

  .tile-bun,
  .tile-realtime,
  .tile-forms {
    grid-column: span 2;
  }

  .tile-bun {
    background: var(--f3-kinako);
    box-shadow: 0 6px 0 #c9a548;
  }

  .tile-bun h3,
  .tile-bun .tile-text {
    color: #3b1f24;
  }

  .tile-bun .tile-icon {
    background: #fffaf5;
  }

  .tile-dango {
    position: absolute;
    right: 1.4rem;
    bottom: -1.4rem;
    rotate: 18deg;
  }

  .tile-realtime .tile-icon {
    background: var(--f3-matcha);
    color: var(--f3-on-matcha);
  }

  .tile-forms .tile-icon {
    background: var(--f3-kinako);
  }

  .tile-visible {
    grid-column: span 6;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 2rem;
    padding: 2rem 2.2rem;
    background: var(--f3-sakura-deep);
    box-shadow: 0 6px 0 #c77388;
  }

  .tile-visible h3,
  .tile-visible .tile-text {
    color: #3b1f24;
  }

  .tile-visible .tile-text code {
    background: rgba(59, 31, 36, 0.12);
    color: #3b1f24;
  }

  .tile-visible .tile-icon {
    background: #fffaf5;
  }

  .tile-visible-copy {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: 36rem;
  }

  .tile-visible-stamp {
    flex: none;
    max-width: 22rem;
  }

  .tile-visible-stamp :global(.stamp) {
    padding: 1rem 1.25rem;
    font-weight: 700;
    font-size: 1rem;
    line-height: 1.4;
    text-align: center;
    color: #3b1f24;
    background: rgba(255, 250, 245, 0.55);
    border: 2.5px dashed rgba(59, 31, 36, 0.35);
    border-radius: 22px;
  }

  .tile-visible-stamp :global(.stamp.done) {
    background: #fffaf5;
    border: 2.5px solid #3b1f24;
    rotate: -3deg;
    animation: stamp 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }

  .tile-visible-stamp :global(.stamp time) {
    font-family: var(--font-mono);
    color: var(--f3-matcha-deep);
  }

  .demos {
    position: relative;
    background: var(--f3-hero-bg);
    padding: 5rem 0 3rem;
  }

  .demo-group {
    margin-bottom: 2.5rem;
  }

  .group-title {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    margin-bottom: 1rem;
  }

  .group-dots {
    display: inline-flex;
    gap: 3px;
    padding: 3px 6px;
    background: #d8b27c;
    border-radius: 999px;
  }

  .group-dots span {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--dango-1);
  }

  .group-dots span:nth-child(2) {
    background: var(--dango-2);
  }

  .group-dots span:nth-child(3) {
    background: var(--dango-3);
  }

  .stickers {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 1rem;
  }

  .demo-hydration {
    --sticker-bg: var(--f3-cat-hydration);
  }

  .demo-data {
    --sticker-bg: var(--f3-cat-data);
  }

  .demo-endpoints {
    --sticker-bg: var(--f3-cat-endpoints);
  }

  .demo-forms {
    --sticker-bg: var(--f3-cat-forms);
  }

  .demo-errors {
    --sticker-bg: var(--f3-cat-errors);
  }

  .demo-sites {
    --sticker-bg: var(--f3-cat-sites);
  }

  .sticker {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 1.05rem 1.15rem 1.15rem;
    color: var(--f3-ink);
    text-decoration: none;
    background: var(--sticker-bg);
    border: 2px solid var(--f3-line);
    border-radius: 22px;
    box-shadow: 0 4px 0 var(--f3-sticker-shadow);
    rotate: -1.1deg;
    transition:
      rotate 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
      translate 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
      box-shadow 0.2s ease;
  }

  .sticker:nth-child(2n) {
    rotate: 0.9deg;
  }

  .sticker:nth-child(3n) {
    rotate: -0.4deg;
  }

  .sticker:hover {
    rotate: 0deg;
    translate: 0 -4px;
    box-shadow: 0 8px 0 var(--f3-sticker-shadow);
  }

  .sticker:focus-visible {
    outline: 3px solid var(--f3-matcha-deep);
    outline-offset: 3px;
  }

  .sticker-head {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }

  .sticker-icon {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex: none;
    border-radius: 50%;
    background: var(--f3-card);
    color: var(--f3-ink);
  }

  .sticker-title {
    font-weight: 700;
    font-size: 1rem;
  }

  .sticker :global(.sticker-ext) {
    margin-left: auto;
    color: var(--f3-ink-soft);
  }

  .sticker-hook {
    font-size: 0.84rem;
    line-height: 1.45;
    color: var(--f3-ink-soft);
  }

  .closing {
    background: var(--f3-hero-bg);
    padding: 2rem 0 4rem;
  }

  .cta-card {
    position: relative;
    overflow: hidden;
    padding: 3.5rem 2rem;
    text-align: center;
    background: var(--f3-matcha);
    border-radius: 40px;
    box-shadow: 0 8px 0 var(--f3-matcha-deep);
  }

  .cta-card h2 {
    font-size: clamp(2rem, 4.5vw, 3.2rem);
    font-weight: 780;
    line-height: 1.02;
    letter-spacing: -0.03em;
    color: #22300f;
    margin-bottom: 0.75rem;
  }

  .cta-card p {
    font-size: 1.08rem;
    color: #3a4d24;
    margin-bottom: 1.75rem;
  }

  .cta-command {
    display: flex;
    justify-content: center;
    margin-bottom: 1.5rem;
  }

  .cta-command :global(.command) {
    --f3-card: #fffaf5;
    --f3-ink: #3b1f24;
    --f3-line: rgba(59, 31, 36, 0.14);
    --f3-card-shadow: #5d7d3f;
    --f3-matcha: #f2a3b5;
    --f3-matcha-deep: #c77388;
    --f3-on-matcha: #3b1f24;
  }

  .cta-docs {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-weight: 700;
    color: #22300f;
    text-decoration: none;
    border-bottom: 2px solid rgba(34, 48, 15, 0.3);
  }

  .cta-docs:hover {
    border-bottom-color: #22300f;
  }

  .cta-dango {
    position: absolute;
    filter: drop-shadow(0 8px 10px rgba(34, 48, 15, 0.25));
  }

  .cta-dango-left {
    left: 6%;
    bottom: -2.5rem;
    rotate: -22deg;
  }

  .cta-dango-right {
    right: 7%;
    top: -1.6rem;
    rotate: 28deg;
  }

  .credits {
    text-align: center;
  }

  .credits :global(.credit) {
    margin-top: 1.5rem;
  }

  .pop {
    animation: pop-in 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) both;
    animation-delay: calc(var(--i, 0) * 90ms);
  }

  @keyframes pop-in {
    from {
      opacity: 0;
      transform: translateY(22px) scale(0.94);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes blob {
    0% {
      border-radius: 44% 56% 52% 48% / 50% 44% 56% 50%;
    }
    50% {
      border-radius: 55% 45% 46% 54% / 44% 55% 45% 56%;
    }
    100% {
      border-radius: 48% 52% 58% 42% / 56% 48% 52% 44%;
    }
  }

  @keyframes bob {
    0%,
    100% {
      translate: 0 0;
    }
    50% {
      translate: 0 -10px;
    }
  }

  @keyframes stamp {
    from {
      opacity: 0;
      transform: scale(1.35);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pop,
    .photo,
    .float,
    .tile-visible-stamp :global(.stamp.done) {
      animation: none;
    }

    .sticker {
      transition: none;
    }
  }

  @media (max-width: 1024px) {
    .hero-inner {
      grid-template-columns: minmax(0, 1fr) minmax(0, 0.85fr);
      gap: 2rem;
    }

    .tile-bun,
    .tile-realtime,
    .tile-forms {
      grid-column: span 3;
    }

    .tile-bun {
      grid-column: span 6;
    }
  }

  @media (max-width: 768px) {
    .masthead {
      padding: 2.5rem 0 5rem;
    }

    .hero-inner {
      grid-template-columns: minmax(0, 1fr);
      padding: 0 1.25rem;
      gap: 2.5rem;
    }

    .hero-art {
      order: -1;
      width: min(78vw, 340px);
    }

    .section-inner {
      padding: 0 1.25rem;
    }

    .bento {
      grid-template-columns: minmax(0, 1fr);
    }

    .tile,
    .tile-island,
    .tile-code,
    .tile-bun,
    .tile-realtime,
    .tile-forms,
    .tile-visible {
      grid-column: auto;
    }

    .tile {
      padding: 1.35rem;
      border-radius: 26px;
    }

    .tile-visible {
      flex-direction: column;
      align-items: stretch;
      padding: 1.5rem;
    }

    .tile-visible-stamp {
      max-width: none;
    }

    .stickers {
      grid-template-columns: minmax(0, 1fr);
    }

    .sticker,
    .sticker:nth-child(2n),
    .sticker:nth-child(3n) {
      rotate: 0deg;
    }

    .cta-card {
      padding: 3rem 1.25rem;
      border-radius: 30px;
    }

    .cta-dango {
      opacity: 0.5;
    }
  }
</style>
