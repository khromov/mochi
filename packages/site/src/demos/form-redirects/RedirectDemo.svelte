<script lang="ts">
  import { enhance } from 'mochi-framework';
  import type { MochiSubmitFunction, MochiEnhanceResult } from 'mochi-framework';

  let { label } = $props<{ label: string }>();

  let redirectResult = $state<{ status: number; location: string } | null>(null);
  let pending = $state(false);

  // Intercept the redirect instead of immediately navigating so we can show
  // the JSON envelope. Call follow() to actually navigate.
  const handleSubmit: MochiSubmitFunction = () => {
    pending = true;
    redirectResult = null;
    return ({ result }: { result: MochiEnhanceResult }) => {
      pending = false;
      if (result.type === 'redirect') {
        redirectResult = { status: result.status, location: result.location };
      }
    };
  };

  function follow(): void {
    if (redirectResult) {
      window.location.assign(redirectResult.location);
    }
  }
</script>

<div class="demo-block">
  <p class="label">{label}</p>
  <form method="POST" action="?/doRedirect" {@attach enhance(handleSubmit)}>
    {#if redirectResult}
      <div class="result" role="status">
        <p>Server returned <code>type: "redirect"</code></p>
        <p><code>status: {redirectResult.status}</code></p>
        <p><code>location: "{redirectResult.location}"</code></p>
        <button type="button" onclick={follow}>Follow redirect</button>
      </div>
    {:else}
      <button type="submit" disabled={pending}>{pending ? 'Redirecting…' : 'Trigger redirect'}</button>
    {/if}
  </form>
</div>

<style>
  .demo-block {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    align-items: flex-start;
    margin-top: 0.75rem;
  }

  .label {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-subtle);
  }

  .result {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.75rem;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
  }

  .result p {
    margin: 0;
  }

  .result button {
    margin-top: 0.5rem;
    align-self: flex-start;
  }

  button {
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

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  button:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  code {
    background: var(--code-bg);
    color: var(--code-accent);
    padding: 0.05rem 0.3rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }
</style>
