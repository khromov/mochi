<script lang="ts">
  import '@fontsource/public-sans';
  import NewsletterForm from './NewsletterForm.svelte';
  import SidechainGuest from './SidechainGuest.svelte';
  import type { MintedCaptcha } from 'mochi-framework';

  let { captcha, source, origins }: { captcha: MintedCaptcha; source: string; origins: string[] } = $props();
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Subscribe to the Mochi newsletter</title>
</svelte:head>

<section class="widget">
  <h2>Subscribe to the Mochi newsletter</h2>
  <p class="blurb">Release notes, deep dives, and the occasional demo. No spam, unsubscribe any time.</p>
  <NewsletterForm mochi:hydrate {captcha} {source} />
</section>

<SidechainGuest mochi:clientOnly {origins} />

<style>
  /* Sidechain reports documentElement.offsetHeight, which the shell's
     `min-height: 100vh` would peg to the iframe's current height — the widget
     could then grow but never shrink back. */
  :global(html) {
    height: auto;
  }

  :global(body) {
    min-height: 0;
    background: transparent;
  }

  .widget {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1.25rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }

  h2 {
    font-family: var(--font-serif);
    font-size: 1.35rem;
    font-weight: 500;
    color: var(--text);
  }

  .blurb {
    margin: 0 0 0.35rem;
    font-size: 0.95rem;
    color: var(--text-muted);
  }
</style>
