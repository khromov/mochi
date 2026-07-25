<script lang="ts">
  import { hydratable } from 'svelte';
  import { enhance, isServer, getRequestContext } from 'mochi-framework';
  import type { MochiSubmitFunction } from 'mochi-framework';

  let { name, label }: { name: string; label: string } = $props();

  // popovertarget needs a real id, and this component is rendered more than once.
  const uid = $props.id();

  // Without JS the Accept button POSTs for real, so the result comes back in the
  // re-rendered page's form snapshot. hydratable() carries that server value across
  // hydration — a plain server read would flip back to empty once the island boots.
  const accepted = await hydratable(`mochi-demo:dialog-accept-${name}`, () => {
    const form = isServer ? getRequestContext().form : null;
    return form?.ok && form.action === 'accept' && form.data.from === name ? String(form.data.value ?? '') : '';
  });

  let dialog: HTMLDialogElement | undefined = $state();
  let enhanced = $state(false);
  let result = $state(accepted);

  // Attachments never run during SSR, so this is the exact moment JS takes over: drop
  // the popover behaviour and drive the dialog with showModal() instead. Until then —
  // and forever, if JS is disabled or fails — the popover attributes work alone.
  function upgrade(node: HTMLDialogElement) {
    dialog = node;
    node.removeAttribute('popover');
    enhanced = true;
  }

  const handleAccept: MochiSubmitFunction<{ value: string; from: string }> = () => {
    return ({ result: submitted }) => {
      if (submitted.type === 'success' && submitted.data) {
        result = submitted.data.value;
      }
      dialog?.close();
    };
  };
</script>

<p class="label">{label}</p>

<button
  type="button"
  popovertarget={uid}
  onclick={(event) => {
    if (enhanced) {
      event.preventDefault();
      dialog?.showModal();
    }
  }}>Open dialog</button
>

<dialog popover id={uid} {@attach upgrade}>
  <h3>Terms of service</h3>
  <p>
    {enhanced ? 'Modal via showModal(). Accept posts through enhance() — no navigation.' : 'Popover baseline, no JavaScript. Accept performs a real POST and the page re-renders.'}
  </p>
  <form method="POST" action="?/accept" {@attach enhance(handleAccept)}>
    <input type="hidden" name="from" value={name} />
    <div class="actions">
      <!-- type="button" matters: a submit button's activation runs form submission
           instead of the popover action, which would leave no-JS visitors unable to
           close the dialog. Accept is a real submit button precisely because it should. -->
      <button type="button" popovertarget={uid} popovertargetaction="hide" onclick={() => enhanced && dialog?.close()}>Cancel</button>
      <button type="submit" class="primary">Accept</button>
    </div>
  </form>
</dialog>

<p class="result">Returned: <code>{result || '—'}</code></p>

<style>
  .label {
    font-size: 0.9rem;
    color: var(--text-subtle);
    margin-bottom: 0.5rem;
  }

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

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
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

  .actions button {
    font-size: 0.9rem;
  }

  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }

  .primary:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
    color: var(--accent-text);
  }

  .result {
    margin-top: 0.85rem;
    font-size: 0.95rem;
    color: var(--text-muted);
  }

  code {
    font-family: var(--font-mono);
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.9em;
  }
</style>
