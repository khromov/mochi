<script lang="ts">
  import { isServer, getRequestContext } from 'mochi-framework';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import AdminLayout from './components/AdminLayout.svelte';
  import type { Profile } from './lib/auth.server';
  import type { FieldErrors } from './lib/validate';

  let { profile, user }: { profile: Profile; user?: string } = $props();

  // Read the action result off the request context (SSR) so the edit form shows
  // validation errors or the success notice after a POST — same pattern as the
  // product form.
  const form = isServer ? getRequestContext().form : null;
  const failData = form && !form.ok ? (form.data as { errors?: FieldErrors<{ name: string; email: string }>; values?: Record<string, string> }) : null;
  const errors = failData?.errors ?? {};
  const values = failData?.values ?? {};
  const notice = form && form.ok && typeof (form.data as { notice?: string }).notice === 'string' ? (form.data as { notice: string }).notice : null;

  const joined = new Date(profile.joinedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const fields = [
    { key: 'name' as const, label: 'Display name', type: 'text', value: values.name ?? profile.name, autocomplete: 'name' },
    { key: 'email' as const, label: 'Email', type: 'email', value: values.email ?? profile.email, autocomplete: 'email' },
  ];
</script>

<AdminLayout title="Profile" active="profile" {user}>
  <!-- Identity header -->
  <div class="mb-6 flex items-center gap-4 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
    <div
      class="flex size-16 shrink-0 items-center justify-center rounded-full bg-matcha-100 font-serif text-2xl font-semibold text-matcha-700 dark:bg-matcha-500/15 dark:text-matcha-300"
    >
      {profile.name.charAt(0).toUpperCase()}
    </div>
    <div class="min-w-0">
      <h2 class="font-serif text-xl font-medium tracking-tight text-stone-900 dark:text-stone-50">{profile.name}</h2>
      <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-500 dark:text-stone-400">
        <span>@{profile.username}</span>
        <span class="inline-flex items-center gap-1 rounded-full bg-matcha-50 px-2 py-0.5 text-xs font-medium text-matcha-700 dark:bg-matcha-500/10 dark:text-matcha-300">
          <ShieldCheck size={12} strokeWidth={2} />
          {profile.role}
        </span>
        <span class="text-stone-400">Joined {joined}</span>
      </div>
    </div>
  </div>

  {#if notice}
    <div
      class="mb-5 flex items-start gap-2.5 rounded-xl border border-matcha-300 bg-matcha-50 px-4 py-3 text-sm text-matcha-800 dark:border-matcha-500/40 dark:bg-matcha-500/10 dark:text-matcha-200"
      role="status"
    >
      <CircleCheck size={16} strokeWidth={1.9} class="mt-0.5 shrink-0" />
      <span>{notice}</span>
    </div>
  {/if}

  <!-- Edit form -->
  <section class="rounded-2xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900">
    <h3 class="mb-1 font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-50">Account details</h3>
    <p class="mb-5 text-sm text-stone-500 dark:text-stone-400">Update how your account appears across the panel.</p>

    <form method="POST" action="?/update" class="max-w-lg space-y-5">
      {#each fields as f (f.key)}
        <div>
          <label for={f.key} class="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">{f.label}</label>
          <input
            id={f.key}
            name={f.key}
            type={f.type}
            value={f.value}
            autocomplete={f.autocomplete}
            aria-invalid={errors[f.key] ? 'true' : undefined}
            class="w-full rounded-lg border bg-white px-3 py-2 text-sm text-stone-900 transition outline-none focus:ring-2 dark:bg-stone-900 dark:text-stone-100
              {errors[f.key]
              ? 'border-rose-400 focus:border-rose-400 focus:ring-rose-200 dark:border-rose-500 dark:focus:ring-rose-500/30'
              : 'border-stone-300 focus:border-matcha-400 focus:ring-matcha-100 dark:border-stone-700 dark:focus:ring-matcha-500/25'}"
          />
          {#if errors[f.key]}
            <p class="mt-1.5 text-xs font-medium text-rose-500 dark:text-rose-400" role="alert">{errors[f.key]}</p>
          {/if}
        </div>
      {/each}

      <div>
        <span class="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">Username</span>
        <input
          value={profile.username}
          disabled
          class="w-full cursor-not-allowed rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-400 dark:border-stone-800 dark:bg-stone-800/50"
        />
        <p class="mt-1.5 text-xs text-stone-400">Usernames can't be changed.</p>
      </div>

      <button
        type="submit"
        class="inline-flex items-center rounded-lg bg-matcha-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-matcha-700 focus-visible:ring-2 focus-visible:ring-matcha-300 focus-visible:outline-none"
      >
        Save changes
      </button>
    </form>
  </section>

  <!-- Security (stub) -->
  <section class="mt-6 flex items-center justify-between gap-4 rounded-2xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900">
    <div class="flex items-start gap-3">
      <span class="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
        <KeyRound size={17} strokeWidth={1.8} />
      </span>
      <div>
        <h3 class="font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-50">Password</h3>
        <p class="text-sm text-stone-500 dark:text-stone-400">Password changes land with the hashing battery (<code class="font-mono text-xs">Bun.password</code>).</p>
      </div>
    </div>
    <span class="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-400 dark:bg-stone-800">Soon</span>
  </section>
</AdminLayout>
