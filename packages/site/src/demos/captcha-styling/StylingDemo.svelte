<script lang="ts">
  import { MochiCaptcha } from 'mochi-framework/components';
  import type { MintedCaptcha } from 'mochi-framework';

  let { captchas }: { captchas: MintedCaptcha[] } = $props();
</script>

<div class="variants">
  <section>
    <h4>Defaults</h4>
    <p>No CSS at all. The widget ships light-mode defaults in each <code>var()</code> fallback, so it looks finished out of the box.</p>
    <MochiCaptcha {...captchas[0]} />
  </section>

  <section>
    <h4>Themed</h4>
    <p>Map the vars onto your palette. These point at this site's tokens, so this one follows the light/dark toggle.</p>
    <div class="themed">
      <MochiCaptcha {...captchas[1]} emoji="🍡" label="Slide the mochi to the right" />
    </div>
  </section>

  <section>
    <h4>Candy</h4>
    <p>The vars are just colours — hand them anything, including gradients.</p>
    <div class="candy">
      <MochiCaptcha {...captchas[2]} emoji="🍭" label="Slide the lollipop" />
    </div>
  </section>

  <section>
    <h4>Terminal</h4>
    <p>Square off the corners with <code>--mochi-captcha-radius</code> for a different silhouette.</p>
    <div class="terminal">
      <MochiCaptcha {...captchas[3]} emoji="▶" label="AWAITING INPUT" />
    </div>
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

  .themed {
    --mochi-captcha-accent: var(--accent);
    --mochi-captcha-accent-soft: var(--accent-soft);
    --mochi-captcha-accent-soft-text: var(--accent-soft-text);
    --mochi-captcha-border: var(--border);
    --mochi-captcha-track-bg: var(--surface-muted);
    --mochi-captcha-handle-bg: var(--surface);
    --mochi-captcha-hint-text: var(--text-subtle);
  }

  .candy {
    --mochi-captcha-accent: #d6336c;
    --mochi-captcha-accent-soft: linear-gradient(90deg, #ffd6e7, #ffa8cd);
    --mochi-captcha-accent-soft-text: #a61e4d;
    --mochi-captcha-border: #ffa8cd;
    --mochi-captcha-track-bg: #fff0f6;
    --mochi-captcha-handle-bg: #fff;
    --mochi-captcha-hint-text: #c2255c;
  }

  .terminal {
    --mochi-captcha-radius: 0;
    --mochi-captcha-accent: #33ff77;
    --mochi-captcha-accent-soft: #04301a;
    --mochi-captcha-accent-soft-text: #33ff77;
    --mochi-captcha-border: #33ff77;
    --mochi-captcha-track-bg: #04150c;
    --mochi-captcha-handle-bg: #04301a;
    --mochi-captcha-hint-text: #2bbd5a;
    font-family: var(--font-mono);
  }
</style>
