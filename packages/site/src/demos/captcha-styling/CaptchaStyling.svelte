<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import StylingDemo from './StylingDemo.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';
  import type { MintedCaptcha } from 'mochi-framework';

  let { captchas }: { captchas: MintedCaptcha[] } = $props();

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Captcha Styling"
  description="The same MochiCaptcha four times over. Every colour is a CSS custom property with a built-in fallback, so styling it is CSS — no props, no theme object, no wrapper component."
  {sources}
>
  <p>
    Set the <code>--mochi-captcha-*</code> vars on any ancestor and they inherit down into the widget. The <code>emoji</code> and <code>label</code> props cover the rest. Each one below
    is live — slide any of them.
  </p>

  <StylingDemo mochi:hydrate {captchas} />
</DemoPage>

<style>
  p {
    margin: 0 0 0.5rem;
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
