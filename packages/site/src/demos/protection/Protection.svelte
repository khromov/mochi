<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import ApiProbe from './ApiProbe.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';
  import type { MochiFormResult } from 'mochi-framework';

  let { form }: { form: MochiFormResult } = $props();

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Protection Mode"
  description="A Cloudflare-style browser check on your own infrastructure. Unverified visitors get an interstitial that auto-solves the captcha proof-of-work and redeems it for a signed clearance cookie — no third party, no tracking."
  {sources}
>
  <p>
    <code>Mochi.serve(&lbrace; protection &rbrace;)</code> gates routes behind browser verification. The first visit answers 403 with an interstitial instead of the page; a hidden
    <code>MochiCaptchaAuto</code> island runs the hash chain and proof-of-work immediately — no slider — then posts the solution and reloads. The clearance is a signed
    <code>HttpOnly</code> cookie, so every later request just passes.
  </p>
  <p>
    <code>protect()</code> picks what's gated; without it every route is protected. This site protects only
    <strong>this demo's</strong> protected page and API — the rest of the site never sees the interstitial.
  </p>

  <p><a href="/demos/protection/protected/">Visit the protected page →</a></p>

  <ApiProbe mochi:hydrate />

  <form method="POST" action="?/reset">
    <button type="submit">Reset clearance</button>
    {#if form?.ok && form.action === 'reset'}
      <span class="cleared">Clearance cookie deleted — the next protected visit shows the interstitial again.</span>
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

  a {
    color: var(--accent);
    font-size: 0.9rem;
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
