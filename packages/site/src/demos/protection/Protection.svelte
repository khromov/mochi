<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import ApiProbe from './ApiProbe.svelte';
  import { compiled } from 'mochi-framework';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';
  import type { MochiFormResult } from 'mochi-framework';

  let { form }: { form: MochiFormResult } = $props();

  const sources = await compiled(() => loadSources(files));
</script>

<DemoPage
  title="Protection Mode"
  description="A Cloudflare-style browser check on your own infrastructure. Unverified visitors get an interstitial that auto-solves the captcha proof-of-work and redeems it for a signed clearance cookie — no third party, no tracking."
  {sources}
>
  <p>
    <strong>This very page is protected</strong> — the interstitial you just passed (or breezed through on a warm clearance) came from
    <code>Mochi.serve(&lbrace; protection &rbrace;)</code>. The first visit answers 403 with a verification page instead of the demo; a hidden
    <code>MochiCaptchaAuto</code> island runs the hash chain and proof-of-work immediately. The clearance is a signed
    <code>HttpOnly</code> cookie, so every later request just passes.
  </p>
  <p>
    <code>protect()</code> is an optional callback that picks what's gated; without it every route is protected. This site protects only this demo page and its API — the rest of the
    site never sees the interstitial.
  </p>

  <ApiProbe mochi:hydrate />

  <form method="POST" action="?/reset">
    <button type="submit">Reset clearance</button>
    {#if form?.ok && form.action === 'reset'}
      <span class="cleared">Clearance cookie deleted — reload the page to meet the interstitial again.</span>
    {/if}
  </form>
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

  form {
    margin-top: 1rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  button {
    padding: 0.4rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
  }

  .cleared {
    font-size: 0.85rem;
    color: var(--text-muted);
  }
</style>
