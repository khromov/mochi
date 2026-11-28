<script lang="ts">
  import { onMount } from 'svelte';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';

  // SSR has no theme, so render 'light' on the server and initial hydration to
  // match; onMount (client-only, post-hydration) then adopts whatever the
  // no-flash script in shell.html already stamped on <html>, avoiding a mismatch.
  let theme = $state<'light' | 'dark'>('light');

  onMount(() => {
    theme = (document.documentElement.dataset.theme as 'light' | 'dark') ?? 'light';
  });

  function toggle() {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('mochi-admin-theme', theme);
    } catch {
      // ignore storage failures (private mode, etc.)
    }
  }
</script>

<button
  type="button"
  onclick={toggle}
  aria-label="Toggle dark mode"
  title="Toggle theme"
  class="inline-flex size-9 items-center justify-center rounded-lg border border-stone-200 text-stone-500 transition hover:border-matcha-300 hover:text-matcha-600 dark:border-stone-700 dark:text-stone-400 dark:hover:border-matcha-500 dark:hover:text-matcha-300"
>
  {#if theme === 'dark'}
    <Sun size={17} strokeWidth={1.8} />
  {:else}
    <Moon size={17} strokeWidth={1.8} />
  {/if}
</button>
