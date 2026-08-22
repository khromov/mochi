<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import EmailForm from './EmailForm.svelte';
  import AttachmentForm from './AttachmentForm.svelte';
  import { compiled } from 'mochi-framework';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await compiled(() => loadSources(files));
</script>

<DemoPage
  title="Send Email"
  description={`Mochi.email() sends transactional mail. In development it uses the dev transport, which captures every message to an in-memory outbox at /_mochi/email instead of delivering it. Bodies here render from a Svelte template via Mochi.email({ component, props }). For safety this demo only lets you send one of a few pre-written emails — the recipient, subject, and body are all fixed server-side.`}
  {sources}
>
  <p>
    Pick one of the pre-written emails and send it. Then open the
    <a href="/_mochi/email" target="_blank" rel="noopener">dev email outbox</a> to read the captured message — the styled HTML body, plain-text part, recipients, and headers.
  </p>
  <h3>With <code>{'{@attach enhance(...)}'}</code></h3>
  <EmailForm mochi:hydrate />
  <h3>Plain HTML</h3>
  <EmailForm />
  <h3>Sending an attachment</h3>
  <p>
    Pass <code>attachments</code> to <code>Mochi.email(&#123; ... &#125;)</code> to send a file alongside the body. The route action reads a small pre-resized image off disk and
    attaches it; the outbox lists it as a <code>📎</code> chip on the captured message.
  </p>
  <AttachmentForm mochi:hydrate />
</DemoPage>

<style>
  h3 {
    margin: 1.5rem 0 0.25rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  p {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  p a {
    color: var(--accent);
    font-weight: 600;
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
