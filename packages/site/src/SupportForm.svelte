<script lang="ts">
  import { enhance, isServer, getRequestContext } from 'mochi-framework';
  import type { MochiEnhanceOptions, MochiSubmitFunction } from 'mochi-framework';

  let { isHydratable }: { isHydratable?: boolean } = $props();

  // For SSR-only (plain HTML) renders, read the form action result so the
  // confirmation / error survives the page re-render after a POST.
  // svelte-ignore state_referenced_locally
  const _form = !isHydratable && isServer ? getRequestContext().form : null;
  const _failError = _form && !_form.ok && typeof _form.data?.error === 'string' ? _form.data.error : null;

  type FailData = { error: string };

  let sent = $state(Boolean(_form?.ok));
  let errorMessage = $state<string | null>(_failError);
  let pending = $state(false);

  const handleSend: MochiSubmitFunction<Record<string, never>, FailData> = () => {
    errorMessage = null;
    return ({ result }) => {
      if (result.type === 'success') {
        sent = true;
        errorMessage = null;
      } else if (result.type === 'failure' && result.data) {
        errorMessage = result.data.error;
      } else if (result.type === 'error') {
        errorMessage = 'Network error. Try again.';
      }
    };
  };

  const sendOpts: MochiEnhanceOptions<Record<string, never>, FailData> = {
    submit: handleSend,
    onPending: (v) => {
      pending = v;
    },
  };

  // --- Slide captcha ---
  const HANDLE = 44;
  let track = $state<HTMLDivElement | null>(null);
  let offset = $state(0);
  let solved = $state(false);
  let dragging = false;
  let pointerStart = 0;
  let offsetStart = 0;

  function maxOffset() {
    return track ? track.clientWidth - HANDLE : 0;
  }

  function settle() {
    if (offset >= maxOffset() - 2) {
      solved = true;
      offset = maxOffset();
    }
  }

  function onPointerDown(e: PointerEvent) {
    if (solved) {
      return;
    }
    dragging = true;
    pointerStart = e.clientX;
    offsetStart = offset;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging || solved) {
      return;
    }
    offset = Math.min(Math.max(offsetStart + e.clientX - pointerStart, 0), maxOffset());
    settle();
  }

  function onPointerUp() {
    dragging = false;
    if (!solved) {
      offset = 0;
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (solved) {
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      offset = Math.min(offset + maxOffset() / 10, maxOffset());
      settle();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      offset = Math.max(offset - maxOffset() / 10, 0);
    }
  }

  function reset() {
    sent = false;
    errorMessage = null;
    solved = false;
    offset = 0;
  }
</script>

{#if sent}
  <div class="sent">
    <p>✅ Thanks — your message is on its way to <strong>support@mochi.fast</strong>. We'll get back to you soon.</p>
    {#if isHydratable}
      <button type="button" class="send-another" onclick={reset}>Send another message</button>
    {:else}
      <a class="send-another" href="/support/">Send another message</a>
    {/if}
  </div>
{:else}
  <form method="POST" action="?/send" class="support-form" {@attach enhance(sendOpts)}>
    <fieldset disabled={pending}>
      <label>
        <span>Name</span>
        <input type="text" name="name" autocomplete="name" maxlength="200" />
      </label>
      <label>
        <span>Email</span>
        <input type="email" name="email" autocomplete="email" required />
      </label>
      <label>
        <span>How can we help?</span>
        <textarea name="message" rows="5" maxlength="5000" required></textarea>
      </label>
    </fieldset>

    <div class="captcha" class:solved>
      <div class="track" bind:this={track}>
        <div class="fill" style="width: {offset + HANDLE}px"></div>
        <div
          class="handle"
          style="transform: translateX({offset}px)"
          role="slider"
          tabindex={solved ? -1 : 0}
          aria-label="Slide the mochi all the way to the right to prove you're human"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={solved ? 100 : track ? Math.round((offset / Math.max(maxOffset(), 1)) * 100) : 0}
          onpointerdown={onPointerDown}
          onpointermove={onPointerMove}
          onpointerup={onPointerUp}
          onpointercancel={onPointerUp}
          onkeydown={onKeyDown}
        >
          🍡
        </div>
        <span class="captcha-hint">{solved ? 'Verified — thanks!' : 'Slide the mochi to the right'}</span>
      </div>
    </div>
    <input type="hidden" name="captcha" value={solved ? 'slid' : ''} />

    <div class="submit-row">
      <button type="submit" disabled={pending || !solved}>{pending ? 'Sending…' : 'Send message'}</button>
      {#if errorMessage}
        <p class="error" role="alert">{errorMessage}</p>
      {/if}
    </div>
  </form>
{/if}

<style>
  .support-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  fieldset:disabled {
    opacity: 0.5;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  label span {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  input[type='text'],
  input[type='email'],
  textarea {
    padding: 0.5rem 0.7rem;
    font-family: inherit;
    font-size: 0.95rem;
    color: var(--text);
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  input:focus-visible,
  textarea:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  textarea {
    resize: vertical;
  }

  .captcha .track {
    position: relative;
    height: 44px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-muted);
    overflow: hidden;
  }

  .captcha .fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent-soft);
    border-radius: 999px;
  }

  .captcha .handle {
    position: absolute;
    inset: 0 auto 0 0;
    width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.35rem;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--accent);
    cursor: grab;
    touch-action: none;
    user-select: none;
    z-index: 1;
  }

  .captcha .handle:active {
    cursor: grabbing;
  }

  .captcha.solved .handle {
    cursor: default;
  }

  .captcha-hint {
    position: absolute;
    inset: 0;
    /* Keep the hint clear of the 44px handle at either end of the track. */
    padding: 0 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    line-height: 1.2;
    font-size: 0.85rem;
    color: var(--text-subtle);
    pointer-events: none;
  }

  .captcha.solved .captcha-hint {
    color: var(--accent-soft-text);
    font-weight: 600;
  }

  .submit-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  button[type='submit'] {
    align-self: flex-start;
    padding: 0.5rem 1rem;
    background: var(--accent);
    color: var(--accent-text);
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
  }

  button[type='submit']:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  button[type='submit']:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .error {
    margin: 0;
    font-size: 0.9rem;
    color: var(--badge-danger-text);
  }

  .sent {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: flex-start;
  }

  .sent p {
    margin: 0;
    color: var(--text-muted);
  }

  .send-another {
    padding: 0.5rem 1rem;
    background: var(--surface-muted);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
  }

  .send-another:hover {
    background: var(--surface);
    border-color: var(--accent);
  }
</style>
