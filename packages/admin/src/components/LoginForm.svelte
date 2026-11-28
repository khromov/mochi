<script lang="ts">
  import { enhance, isServer, getRequestContext } from 'mochi-framework';
  import type { MochiEnhanceOptions, MochiSubmitFunction } from 'mochi-framework';

  // Progressive enhancement: with JS, `enhance` intercepts submit and the
  // callback below updates state without a reload. Without JS, a failed POST
  // re-renders this page server-side — read the action result off the request
  // context (server-only) so the error shows and the username repopulates.
  const form = isServer ? getRequestContext().form : null;
  const failData = form && !form.ok ? (form.data as { error?: string; username?: string }) : null;

  // Bind username to local state so a typed value survives the reactive
  // re-render when errorMessage changes on a failed enhanced submit.
  let username = $state(typeof failData?.username === 'string' ? failData.username : '');
  let errorMessage = $state<string | null>(typeof failData?.error === 'string' ? failData.error : null);
  let pending = $state(false);

  const onSubmit: MochiSubmitFunction<Record<string, never>, { error: string; username: string }> = () => {
    errorMessage = null;
    return ({ result, update }) => {
      if (result.type === 'failure' && result.data) {
        errorMessage = result.data.error;
      } else if (result.type === 'error') {
        errorMessage = 'Network error. Try again.';
      } else {
        // success or redirect → default behavior (follows the Location header).
        void update();
      }
    };
  };

  const opts: MochiEnhanceOptions<Record<string, never>, { error: string; username: string }> = {
    submit: onSubmit,
    onPending: (v) => {
      pending = v;
    },
  };
</script>

<form method="POST" action="/login/?/login" class="space-y-4" {@attach enhance(opts)}>
  <div>
    <label for="username" class="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">Username</label>
    <input
      id="username"
      name="username"
      bind:value={username}
      disabled={pending}
      required
      autocomplete="username"
      class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 transition outline-none placeholder:text-stone-400 focus:border-matcha-400 focus:ring-2 focus:ring-matcha-100 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:ring-matcha-500/25"
    />
  </div>

  <div>
    <label for="password" class="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">Password</label>
    <input
      id="password"
      name="password"
      type="password"
      disabled={pending}
      required
      autocomplete="current-password"
      class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 transition outline-none placeholder:text-stone-400 focus:border-matcha-400 focus:ring-2 focus:ring-matcha-100 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:ring-matcha-500/25"
    />
  </div>

  {#if errorMessage}
    <p class="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600 dark:bg-rose-500/10 dark:text-rose-400" role="alert">{errorMessage}</p>
  {/if}

  <button
    type="submit"
    disabled={pending}
    class="w-full rounded-lg bg-matcha-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-matcha-700 focus-visible:ring-2 focus-visible:ring-matcha-300 focus-visible:outline-none disabled:opacity-60"
  >
    {pending ? 'Signing in…' : 'Sign in'}
  </button>
</form>
