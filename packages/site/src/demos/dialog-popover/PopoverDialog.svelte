<button type="button" popovertarget="terms">Open dialog</button>

<dialog popover id="terms">
  <h3>Terms of service</h3>
  <p>Server-rendered HTML. This component ships no JavaScript at all — the browser opens and closes it from the attributes alone.</p>
  <button type="button" popovertarget="terms" popovertargetaction="hide">Close</button>
</dialog>

<style>
  dialog {
    /* The shell's `* { margin: 0 }` reset kills the UA's `margin: auto`, which is
       what centers the dialog in the top layer — without this it renders top-left. */
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

  button {
    font: inherit;
    font-size: 1rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      color 0.12s ease;
  }

  button:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-soft-text);
  }

  button:focus-visible {
    box-shadow: var(--focus-ring);
    outline: none;
  }

  dialog button {
    font-size: 0.9rem;
  }
</style>
