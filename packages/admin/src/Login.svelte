<script lang="ts">
  import '@fontsource-variable/fraunces/full.css';
  import '@fontsource-variable/public-sans';
  import './styles/app.generated.css';
  import LoginForm from './components/LoginForm.svelte';

  // The demo credential hint is passed from the route's serverProps so this
  // page never imports the server-only auth module.
  let { demoUser }: { demoUser: { username: string; password: string } } = $props();
  const hint = $derived(demoUser);
</script>

<div class="grid min-h-screen place-items-center bg-stone-50 px-4 font-sans text-stone-800 dark:bg-stone-950 dark:text-stone-200">
  <div class="w-full max-w-sm">
    <div class="mb-8 text-center">
      <div class="mb-3 text-3xl">🍡</div>
      <h1 class="font-serif text-2xl font-medium tracking-tight text-stone-900 dark:text-stone-50">
        mochi <span class="text-matcha-600 dark:text-matcha-400">admin</span>
      </h1>
      <p class="mt-1 text-sm text-stone-500 dark:text-stone-400">Sign in to continue</p>
    </div>

    <div class="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <LoginForm mochi:hydrate />
    </div>

    <p class="mt-5 text-center text-xs text-stone-400">
      Demo credentials — <code class="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-stone-600 dark:bg-stone-800 dark:text-stone-300">{hint.username}</code>
      /
      <code class="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-stone-600 dark:bg-stone-800 dark:text-stone-300">{hint.password}</code>
    </p>
  </div>
</div>
