<script lang="ts">
  import { MochiCaptcha } from 'mochi-framework/components';
  import CodeSnippet from '../../components/CodeSnippet.svelte';
  import { themes } from './themes.ts';
  import type { ThemeName } from './themes.ts';
  import type { MintedCaptcha, MochiDirectives } from 'mochi-framework';

  type Snippets = Record<ThemeName | 'defaults', string>;

  let { captchas, css, svelte }: { captchas: MintedCaptcha[]; css: Snippets; svelte: Snippets } & MochiDirectives = $props();
</script>

<div class="variants">
  <section>
    <h4>Defaults</h4>
    <p>No CSS at all. The widget ships light-mode defaults in each <code>var()</code> fallback, so it looks finished out of the box.</p>
    <MochiCaptcha {...captchas[0]} />
    <CodeSnippet html={svelte.defaults} />
    <CodeSnippet html={css.defaults} />
  </section>

  <section>
    <h4>Themed</h4>
    <p>Map the vars onto your palette. These point at this site's tokens, so this one follows the light/dark toggle.</p>
    <div style={themes.themed.css}>
      <MochiCaptcha
        {...captchas[1]}
        emoji={themes.themed.emoji}
        label={themes.themed.label}
        verifyingLabel={themes.themed.verifyingLabel}
        verifiedLabel={themes.themed.verifiedLabel}
      />
    </div>
    <CodeSnippet html={svelte.themed} />
    <CodeSnippet html={css.themed} />
  </section>

  <section>
    <h4>Candy</h4>
    <p>The vars are just colours — hand them anything, including gradients.</p>
    <div style={themes.candy.css}>
      <MochiCaptcha
        {...captchas[2]}
        emoji={themes.candy.emoji}
        label={themes.candy.label}
        verifyingLabel={themes.candy.verifyingLabel}
        verifiedLabel={themes.candy.verifiedLabel}
      />
    </div>
    <CodeSnippet html={svelte.candy} />
    <CodeSnippet html={css.candy} />
  </section>

  <section>
    <h4>Terminal</h4>
    <p>Square off the corners with <code>--mochi-captcha-radius</code> for a different silhouette.</p>
    <div style={themes.terminal.css}>
      <MochiCaptcha
        {...captchas[3]}
        emoji={themes.terminal.emoji}
        label={themes.terminal.label}
        verifyingLabel={themes.terminal.verifyingLabel}
        verifiedLabel={themes.terminal.verifiedLabel}
      />
    </div>
    <CodeSnippet html={svelte.terminal} />
    <CodeSnippet html={css.terminal} />
  </section>
</div>

<style>
  .variants {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    max-width: 30rem;
    margin-top: 1rem;
  }

  h4 {
    margin: 0 0 0.2rem;
    font-size: 0.9rem;
    font-weight: 600;
  }

  p {
    margin: 0 0 0.6rem;
    font-size: 0.85rem;
    color: var(--text-subtle);
  }

  code {
    background: var(--code-bg);
    color: var(--code-accent);
    padding: 0.05rem 0.3rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }
</style>
