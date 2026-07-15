<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import CaptchaForm from './CaptchaForm.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';
  import type { MintedCaptcha } from 'mochi-framework';

  let { captcha }: { captcha: MintedCaptcha } = $props();

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Captcha"
  description="A slide-to-verify captcha with no third party and no tracking. Sliding advances a hash chain and solves a proof-of-work, so a passing submit proves the page was really loaded and the work was really done."
  {sources}
>
  <p>
    <code>mintCaptcha()</code> seals a single-use token at SSR. Sliding the handle advances a hash chain one link per step, then solves a proof-of-work over the final link — so the
    challenge only exists once the slide has actually run, and never appears in the page.
    <code>verifyCaptcha()</code> re-derives it server-side.
  </p>
  <p>
    The submit button is <strong>not</strong> gated on the captcha here, so you can submit without solving it and watch the server reject you. Submit twice on one solved token and the
    replay check rejects the second.
  </p>

  <CaptchaForm mochi:hydrate {captcha} />
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
