<script lang="ts">
  import { enhance, isServer, getRequestContext } from 'mochi-framework';
  import type { MochiEnhanceOptions, MochiSubmitFunction } from 'mochi-framework';

  let { initialUser, isHydratable }: { initialUser: string | null; isHydratable?: boolean } = $props();

  // For SSR-only (plain HTML) renders, read the form action result so errors
  // and the prefilled username survive the re-render after a failed POST.
  // svelte-ignore state_referenced_locally
  const _form = !isHydratable && isServer ? getRequestContext().form : null;
  const _failData = _form && !_form.ok ? _form.data : null;

  // initialUser is the SSR snapshot — local state takes over after hydration.
  // svelte-ignore state_referenced_locally
  let currentUser = $state(initialUser);
  let errorMessage = $state<string | null>(typeof _failData?.error === 'string' ? _failData.error : null);
  const prefillUsername = typeof _failData?.username === 'string' ? _failData.username : '';
  let pending = $state(false);

  const handleLogin: MochiSubmitFunction<{ username: string }, { error: string; username: string }> = () => {
    errorMessage = null;

    return ({ result, formElement }) => {
      if (result.type === 'success' && result.data) {
        currentUser = result.data.username;
        errorMessage = null;
        formElement.reset();
      } else if (result.type === 'failure' && result.data) {
        errorMessage = result.data.error;
      } else if (result.type === 'error') {
        errorMessage = 'Network error. Try again.';
      }
    };
  };

  const loginEnhanceOpts: MochiEnhanceOptions<{ username: string }, { error: string; username: string }> = {
    submit: handleLogin,
    onPending: (v) => {
      pending = v;
    },
  };
</script>

{#if currentUser}
  <div class="signed-in">
    <p>Signed in as <strong>{currentUser}</strong>.{isHydratable ? ' No page reloads happened on the way here.' : ''}</p>
    <!-- The default fallback handles redirect by calling window.location.assign,
         which works fine for logout. No callback needed. -->
    <form method="POST" action="?/logout" {@attach enhance()}>
      <button type="submit">Log out</button>
    </form>
  </div>
{:else}
  <form method="POST" action="?/default" class="login" {@attach enhance(loginEnhanceOpts)}>
    <label>
      <span>Username</span>
      <input name="username" value={prefillUsername} disabled={pending} required />
    </label>
    <label>
      <span>Password</span>
      <input name="password" type="password" disabled={pending} required />
    </label>
    <div class="submit-row">
      <button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Log in'}</button>
      {#if errorMessage}
        <p class="error" role="alert">{errorMessage}</p>
      {/if}
    </div>
    <p class="hint">The password is <code>hunter2</code>. Any username works.</p>
  </form>
{/if}

<style>
  .signed-in {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: flex-start;
  }

  .login {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .login label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .login input {
    padding: 0.5rem 0.7rem;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: 0.95rem;
  }

  .login input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background: var(--surface-muted);
  }

  .login input:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
  }

  .login button {
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

  .login button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .login button:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  .submit-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .signed-in button {
    align-self: flex-start;
    padding: 0.5rem 1rem;
    background: var(--surface-muted);
    color: var(--badge-danger-text);
    border: 1px solid var(--badge-danger-bg);
    border-radius: var(--radius-md);
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
  }

  .signed-in button:hover {
    background: var(--badge-danger-bg);
  }

  .error {
    margin: 0;
    font-size: 0.9rem;
    color: var(--badge-danger-text);
  }

  .hint {
    font-size: 0.8rem;
    color: var(--text-subtle);
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
