<script lang="ts">
  import { url } from 'mochi-framework';
  import { MetaTags } from 'svelte-meta-tags';
  import MailerForm from './MailerForm.svelte';
  import { mergeMetaTags } from '../lib/baseMetaTags';

  const metaTags = mergeMetaTags({
    title: 'Mailer — a Mochi + Mailgun demo',
    description: 'Send a real email to any address via Mailgun, in plain text, raw HTML, or a Svelte template.',
    canonical: `https://demos.mochi.fast${url.pathname}`,
  });
</script>

<MetaTags {...metaTags} />

<main class="page">
  <div class="card">
    <h1>Send an email</h1>
    <p class="lede">
      Delivered through <code>Mochi.email()</code> using a Mailgun <code>smtp</code> transport. Pick a body format — plain text, raw HTML, or a Svelte component with its own scoped styling.
    </p>
    <MailerForm mochi:hydrate />
  </div>
</main>

<style>
  :global(body) {
    margin: 0;
    min-height: 100vh;
    background: #faf8ff;
    color: #1f1533;
    font-family:
      'Public Sans',
      ui-sans-serif,
      system-ui,
      -apple-system,
      'Segoe UI',
      sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  .page {
    max-width: 32rem;
    margin: 0 auto;
    padding: clamp(2.5rem, 6vw, 4.5rem) 1.25rem;
  }

  .card {
    background: #ffffff;
    border: 1px solid #ece6f7;
    border-radius: 16px;
    padding: 2rem;
    box-shadow: 0 4px 16px rgba(91, 58, 201, 0.06);
  }

  h1 {
    margin: 0 0 0.5rem;
    font-size: 1.6rem;
  }

  .lede {
    margin: 0 0 1.5rem;
    font-size: 0.9rem;
    color: #6b647c;
    line-height: 1.55;
  }

  .lede code {
    background: #f4f0ff;
    color: #7c3aed;
    padding: 0.05rem 0.35rem;
    border-radius: 4px;
    font-size: 0.85em;
  }
</style>
