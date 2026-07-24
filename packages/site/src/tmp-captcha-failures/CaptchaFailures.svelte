<script lang="ts">
  import FailurePanel from './FailurePanel.svelte';
  import type { MintedCaptcha } from 'mochi-framework';

  let { captcha }: { captcha: MintedCaptcha } = $props();
</script>

<main>
  <h1>Captcha failure states</h1>
  <p>Temporary scratch page — every documented way <code>&lt;MochiCaptcha /&gt;</code> can fail, side by side.</p>

  <FailurePanel mochi:hydrate {captcha} />
</main>

<style>
  main {
    max-width: 46rem;
    margin: 0 auto;
    padding: 2rem 1.25rem 4rem;
    font-family: var(--font-sans, system-ui, sans-serif);
    color: var(--text);
  }

  h1 {
    margin: 0 0 0.25rem;
    font-size: 1.5rem;
  }

  main > p {
    margin: 0 0 2rem;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  code {
    background: var(--code-bg);
    color: var(--code-accent);
    padding: 0.05rem 0.35rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }
</style>
