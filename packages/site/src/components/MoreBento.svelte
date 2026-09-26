<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import FileText from '@lucide/svelte/icons/file-text';
  import Puzzle from '@lucide/svelte/icons/puzzle';
  import ScrollText from '@lucide/svelte/icons/scroll-text';
  import { libraryLogos } from '../lib/libraryLogos';
  import { moreCards, type MoreCard } from '../lib/moreCards';

  const byId = Object.fromEntries(moreCards.map((card) => [card.id, card])) as Record<MoreCard['id'], MoreCard>;
  const deploy = byId.deploy;
  const dx = byId.dx;
  const libraries = byId.libraries;
  const agent = byId.agent;
  const testing = byId.testing;
</script>

<div class="bento">
  <article class="cell cell-deploy">
    <div class="copy">
      <h3>{deploy.title}</h3>
      <p>{deploy.body}</p>
      <a href={deploy.href}>{deploy.cta} <ArrowRight size={15} strokeWidth={2} /></a>
    </div>
    <figure class="terminal" aria-label="Build and run commands">
      <div class="terminal-bar"><span></span><span></span><span></span></div>
      <pre><span class="prompt">$</span> bun run build
<span class="dim">✓ 14 islands · 3 server islands · 212 kB</span>
<span class="prompt">$</span> docker build -t my-site .
<span class="dim">✓ oven/bun:1 · 294 MB</span>
<span class="prompt">$</span> docker run -p 3000:3000 my-site
<span class="ok">BOOT</span> <span class="dim">listening on http://0.0.0.0:3000</span></pre>
    </figure>
  </article>

  <article class="cell cell-dx">
    <div class="copy">
      <h3>{dx.title}</h3>
      <p>{dx.body}</p>
      <a href={dx.href}>{dx.cta} <ArrowRight size={15} strokeWidth={2} /></a>
    </div>
    <figure class="debugbar" aria-label="The Mochi debug bar">
      <span class="brand"><span aria-hidden="true">🍡</span> mochi</span>
      <span class="tab">Request</span>
      <span class="tab">Islands <b class="badge">3</b></span>
      <span class="tab">JS <b class="badge">9 kB</b></span>
    </figure>
  </article>

  <article class="cell cell-libraries">
    <div class="copy">
      <h3>{libraries.title}</h3>
      <p>{libraries.body}</p>
      <a href={libraries.href}>{libraries.cta} <ArrowRight size={15} strokeWidth={2} /></a>
    </div>
    <ul class="logos" aria-label="Libraries that work unchanged">
      {#each libraryLogos as logo (logo.name)}
        <li>
          <span class="logo" style:--brand={logo.color}>
            {#if logo.svg}
              <!-- eslint-disable-next-line svelte/no-at-html-tags -- static inline logo markup from lib/libraryLogos.ts -->
              {@html logo.svg}
            {:else}
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={logo.path} /></svg>
            {/if}
          </span>
          <span class="logo-name">{logo.name}</span>
        </li>
      {/each}
    </ul>
  </article>

  <article class="cell cell-agent">
    <div class="copy">
      <h3>{agent.title}</h3>
      <p>{agent.body}</p>
      <a href={agent.href}>{agent.cta} <ArrowRight size={15} strokeWidth={2} /></a>
    </div>
    <figure class="orbit" aria-label="Mochi docs reach Claude Code, Cursor, and Copilot through an MCP server, an agent skill, and llms.txt">
      <span class="ring ring-outer" aria-hidden="true"></span>
      <span class="ring ring-inner" aria-hidden="true"></span>
      <span class="core"><span aria-hidden="true">🍡</span> docs</span>
      <span class="sat sat-mcp"><Puzzle size={12} strokeWidth={2} /> MCP</span>
      <span class="sat sat-skill"><FileText size={12} strokeWidth={2} /> SKILL.md</span>
      <span class="sat sat-llms"><ScrollText size={12} strokeWidth={2} /> llms.txt</span>
      <span class="agent agent-claude">Claude Code</span>
      <span class="agent agent-cursor">Cursor</span>
      <span class="agent agent-copilot">Copilot</span>
    </figure>
  </article>

  <article class="cell cell-testing">
    <div class="copy">
      <h3>{testing.title}</h3>
      <p>{testing.body}</p>
      <a href={testing.href}>{testing.cta} <ArrowRight size={15} strokeWidth={2} /></a>
    </div>
    <figure class="terminal terminal-tests" aria-label="Test run output">
      <div class="terminal-bar"><span></span><span></span><span></span></div>
      <pre><span class="prompt">$</span> bun test
<span class="ok">✓</span> forms.test.ts <span class="dim">12 ms</span>
<span class="ok">✓</span> islands.test.ts <span class="dim">31 ms</span>
<span class="ok">✓</span> app.test.ts <span class="dim">full app · 1.2 s</span>
<span class="dim">3 files · 41 pass · 0 fail</span></pre>
    </figure>
  </article>
</div>

<style>
  .bento {
    --tint-deploy: #e3ebf1;
    --ink-deploy: #2b4a63;
    --tint-dx: #e2ece3;
    --ink-dx: #2f5b3f;
    --tint-libraries: #f5ecd3;
    --ink-libraries: #6d5200;
    --tint-agent: #ebe5f2;
    --ink-agent: #4d3a6a;
    --tint-testing: #f2e4ea;
    --ink-testing: #6a3652;
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    grid-auto-rows: auto;
    gap: 1rem;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .bento {
      --tint-deploy: #1e272e;
      --ink-deploy: #a9c6dd;
      --tint-dx: #22302a;
      --ink-dx: #c7e0cd;
      --tint-libraries: #302c1c;
      --ink-libraries: #e2bd52;
      --tint-agent: #29232f;
      --ink-agent: #cbb8e3;
      --tint-testing: #2f2329;
      --ink-testing: #dcb4c8;
    }
  }

  :global(:root[data-theme='dark']) .bento {
    --tint-deploy: #1e272e;
    --ink-deploy: #a9c6dd;
    --tint-dx: #22302a;
    --ink-dx: #c7e0cd;
    --tint-libraries: #302c1c;
    --ink-libraries: #e2bd52;
    --tint-agent: #29232f;
    --ink-agent: #cbb8e3;
    --tint-testing: #2f2329;
    --ink-testing: #dcb4c8;
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 1.5rem;
    background: linear-gradient(180deg, var(--tint) 0%, color-mix(in srgb, var(--tint) 45%, var(--surface)) 100%);
    border: 1px solid color-mix(in srgb, var(--ink) 16%, var(--border));
    border-radius: var(--radius-lg);
    min-width: 0;
  }

  .cell-deploy {
    --tint: var(--tint-deploy);
    --ink: var(--ink-deploy);
  }

  .cell-dx {
    --tint: var(--tint-dx);
    --ink: var(--ink-dx);
  }

  .cell-libraries {
    --tint: var(--tint-libraries);
    --ink: var(--ink-libraries);
  }

  .cell-agent {
    --tint: var(--tint-agent);
    --ink: var(--ink-agent);
  }

  .cell-testing {
    --tint: var(--tint-testing);
    --ink: var(--ink-testing);
  }

  .cell-deploy {
    grid-column: span 8;
    flex-direction: row;
    align-items: center;
    gap: 2rem;
  }

  .cell-deploy .copy {
    flex: 0 0 38%;
  }

  .cell-dx,
  .cell-libraries,
  .cell-agent,
  .cell-testing {
    grid-column: span 4;
  }

  .cell-dx {
    justify-content: space-between;
  }

  .terminal-tests {
    flex: 0 0 auto;
    margin-top: auto;
  }

  .copy {
    display: grid;
    gap: 0.5rem;
  }

  h3 {
    font-family: var(--font-serif);
    font-size: 1.35rem;
    line-height: 1.2;
    font-weight: 450;
    color: var(--text);
    letter-spacing: -0.015em;
    font-variation-settings:
      'opsz' 144,
      'SOFT' 50;
  }

  p {
    font-size: 0.95rem;
    line-height: 1.55;
    color: var(--text-muted);
  }

  a {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    width: fit-content;
    margin-top: 0.3rem;
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--ink);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  a:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .terminal {
    flex: 1;
    min-width: 0;
    margin: 0;
    background: var(--code-bg);
    border: 1px solid var(--code-chrome-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .terminal-bar {
    display: flex;
    gap: 0.35rem;
    padding: 0.5rem 0.75rem;
    background: var(--code-chrome-bg);
    border-bottom: 1px solid var(--code-chrome-border);
  }

  .terminal-bar span {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--code-muted);
    opacity: 0.5;
  }

  pre {
    margin: 0;
    padding: 0.9rem 1rem;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    line-height: 1.7;
    color: var(--code-text);
    overflow-x: auto;
  }

  .prompt,
  .dim {
    color: var(--code-muted);
  }

  .ok {
    color: #8ab79a;
    font-weight: 600;
  }

  .debugbar {
    display: inline-flex;
    align-items: center;
    gap: 0.55em;
    width: fit-content;
    max-width: 100%;
    margin: 0;
    padding: 0.4em 0.55em;
    height: 3em;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 10.5px;
    background: #1f221c;
    color: #e8e6dd;
    border: 1px solid #434836;
    border-radius: 12px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
    white-space: nowrap;
    overflow: hidden;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.45em;
    padding: 0.3em 0.55em 0.3em 0.4em;
    font-family: var(--font-serif);
    font-size: 1.1em;
    font-weight: 500;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    padding: 0.3em 0.55em;
    border-radius: 6px;
    background: #272a22;
    color: #e8e6dd;
    font-weight: 500;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    height: 1.4em;
    padding: 0 0.45em;
    border-radius: 999px;
    background: rgba(138, 183, 154, 0.28);
    color: #e8f0e0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.82em;
    font-weight: 600;
  }

  .logos {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.9rem 1rem;
  }

  .logos li {
    display: grid;
    justify-items: center;
    gap: 0.35rem;
    width: 3.4rem;
  }

  .logo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: var(--radius-md);
    background: var(--surface);
    border: 1px solid color-mix(in srgb, var(--ink) 16%, var(--border));
    color: var(--brand);
  }

  .logo :global(svg) {
    width: 1.45rem;
    height: 1.45rem;
    fill: currentColor;
  }

  .logo-name {
    font-size: 0.7rem;
    line-height: 1.2;
    font-weight: 500;
    color: var(--text-subtle);
    text-align: center;
  }

  .orbit {
    --core: 3.4rem;
    position: relative;
    height: 11rem;
    margin: 0;
    border-radius: var(--radius-md);
    background: radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--ink) 14%, transparent) 0, transparent 62%);
    overflow: hidden;
  }

  .ring {
    position: absolute;
    top: 50%;
    left: 50%;
    border: 1.5px dashed color-mix(in srgb, var(--ink) 40%, var(--border-strong));
    border-radius: 50%;
    transform: translate(-50%, -50%);
  }

  .ring-inner {
    width: 7.5rem;
    height: 7.5rem;
  }

  .ring-outer {
    width: 15rem;
    height: 15rem;
    opacity: 0.7;
  }

  .core {
    position: absolute;
    top: 50%;
    left: 50%;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.35rem 0.75rem;
    transform: translate(-50%, -50%);
    border: 2px solid var(--text);
    border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
    background: var(--surface);
    box-shadow: 3px 3px 0 var(--border-strong);
    font-family: var(--font-serif);
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--text);
  }

  .sat,
  .agent {
    position: absolute;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    white-space: nowrap;
    transform: translate(-50%, -50%);
  }

  .sat {
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    background: var(--ink);
    color: var(--tint);
    font-size: 0.72rem;
    font-weight: 600;
  }

  .sat-mcp {
    left: 24%;
    top: 30%;
  }

  .sat-skill {
    left: 76%;
    top: 32%;
  }

  .sat-llms {
    left: 50%;
    top: 84%;
  }

  .agent {
    padding: 0.2rem 0.55rem;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
    font-size: 0.7rem;
    font-weight: 500;
  }

  .agent-claude {
    left: 14%;
    top: 76%;
  }

  .agent-cursor {
    left: 88%;
    top: 74%;
  }

  .agent-copilot {
    left: 60%;
    top: 12%;
  }

  @media (max-width: 1024px) {
    .cell-deploy {
      grid-column: span 12;
      flex-direction: column;
      align-items: stretch;
    }

    .cell-dx,
    .cell-libraries,
    .cell-agent,
    .cell-testing {
      grid-column: span 6;
    }
  }

  @media (max-width: 600px) {
    .cell-dx,
    .cell-libraries,
    .cell-agent,
    .cell-testing {
      grid-column: span 12;
    }
  }
</style>
