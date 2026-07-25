<script lang="ts">
  import { url } from 'mochi-framework';

  let { name, label }: { name: string; label: string } = $props();

  // Read isomorphically so the same expression drives the server render and the
  // pre-hydration DOM. This is the whole no-JS baseline: `?<name>` in the URL means
  // the dialog is rendered already open.
  const openFromUrl = $derived(url.searchParams.has(name));

  let dialog: HTMLDialogElement;

  function open(event: MouseEvent) {
    event.preventDefault();
    dialog.showModal();
  }

  function close(event: MouseEvent) {
    event.preventDefault();
    dialog.close();
  }

  // A deep link arrives as `<dialog open>`, which is visible but sits in normal flow
  // rather than the top layer. Once JS is running, re-open it as a true modal.
  $effect(() => {
    if (openFromUrl && !dialog.matches(':modal')) {
      dialog.close();
      dialog.showModal();
    }
  });
</script>

<p class="label">{label}</p>

<a class="btn" href="?{name}" onclick={open}>Open dialog</a>

<dialog bind:this={dialog} open={openFromUrl}>
  <h3>Terms of service</h3>
  <p>
    Opened by <strong>{openFromUrl ? 'a link navigation' : 'showModal()'}</strong>. The markup is identical either way — only the click handler differs, and it only exists
    once JavaScript has loaded.
  </p>
  <a class="btn" href="?" onclick={close}>Close</a>
</dialog>

<style>
  .label {
    font-size: 0.9rem;
    color: var(--text-subtle);
    margin-bottom: 0.5rem;
  }

  .btn {
    display: inline-block;
    font: inherit;
    font-size: 1rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    text-decoration: none;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      color 0.12s ease;
  }

  .btn:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-soft-text);
  }

  .btn:focus-visible {
    box-shadow: var(--focus-ring);
    outline: none;
  }

  dialog {
    /* The shell's `* { margin: 0 }` reset kills the UA's `margin: auto`, which is
       what centers a modal dialog — without this it renders in the top-left. */
    margin: auto;
    max-width: 26rem;
    width: calc(100vw - 2rem);
    padding: 1.25rem 1.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }

  dialog::backdrop {
    background: rgba(31, 42, 36, 0.45);
  }

  h3 {
    font-family: var(--font-serif);
    font-size: 1.25rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
  }

  dialog p {
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1.5;
    margin-bottom: 1.25rem;
  }

  dialog .btn {
    font-size: 0.9rem;
  }
</style>
