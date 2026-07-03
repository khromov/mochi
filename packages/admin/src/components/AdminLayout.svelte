<script lang="ts">
  import '@fontsource-variable/fraunces/full.css';
  import '@fontsource-variable/public-sans';
  import '../styles/app.generated.css';

  import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
  import Package from '@lucide/svelte/icons/package';
  import LogOut from '@lucide/svelte/icons/log-out';
  import type { Component, Snippet } from 'svelte';
  import ThemeToggle from './ThemeToggle.svelte';

  interface Props {
    title: string;
    active: 'dashboard' | 'products';
    user?: string;
    children: Snippet;
  }

  let { title, active, user = 'admin', children }: Props = $props();

  const nav: { key: Props['active']; label: string; href: string; icon: Component }[] = [
    { key: 'dashboard', label: 'Dashboard', href: '/', icon: LayoutDashboard },
    { key: 'products', label: 'Products', href: '/products/', icon: Package },
  ];
</script>

<div class="min-h-screen bg-stone-50 font-sans text-stone-800 dark:bg-stone-950 dark:text-stone-200">
  <div class="mx-auto grid min-h-screen w-full grid-cols-1 md:grid-cols-[240px_1fr]">
    <!-- Sidebar -->
    <aside
      class="flex flex-col gap-1 border-b border-stone-200 bg-white px-3 pt-5 pb-3 md:sticky md:top-0 md:h-screen md:border-r md:border-b-0 dark:border-stone-800 dark:bg-stone-900"
    >
      <a href="/" class="mb-5 flex items-baseline gap-2 px-3">
        <span class="text-lg">🍡</span>
        <span class="font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-50">mochi</span>
        <span class="text-[0.62rem] font-semibold tracking-[0.14em] text-matcha-600 uppercase dark:text-matcha-400">admin</span>
      </a>

      <nav class="flex flex-row gap-1 md:flex-col">
        {#each nav as item (item.key)}
          {@const Icon = item.icon}
          <a
            href={item.href}
            aria-current={active === item.key ? 'page' : undefined}
            class="group inline-flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition md:flex-none
              {active === item.key
              ? 'bg-matcha-50 font-semibold text-matcha-700 dark:bg-matcha-500/10 dark:text-matcha-300'
              : 'text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100'}"
          >
            <Icon
              size={16}
              strokeWidth={1.8}
              class={active === item.key ? 'text-matcha-600 dark:text-matcha-400' : 'text-stone-400 group-hover:text-matcha-600 dark:group-hover:text-matcha-400'}
            />
            <span>{item.label}</span>
          </a>
        {/each}
      </nav>

      <!-- User + logout, pinned to the bottom on desktop -->
      <form method="POST" action="/login/?/logout" class="mt-auto hidden items-center gap-2 border-t border-stone-200 pt-3 md:flex dark:border-stone-800">
        <div class="flex size-8 items-center justify-center rounded-full bg-matcha-100 font-serif text-sm font-semibold text-matcha-700 dark:bg-matcha-500/15 dark:text-matcha-300">
          {user.charAt(0).toUpperCase()}
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-stone-700 dark:text-stone-300">{user}</p>
          <p class="text-xs text-stone-400">Signed in</p>
        </div>
        <button
          type="submit"
          aria-label="Log out"
          title="Log out"
          class="inline-flex size-8 items-center justify-center rounded-lg text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
        >
          <LogOut size={16} strokeWidth={1.8} />
        </button>
      </form>
    </aside>

    <!-- Main -->
    <div class="flex min-w-0 flex-col">
      <header class="flex items-center justify-between gap-4 border-b border-stone-200 bg-white/70 px-6 py-4 backdrop-blur-sm dark:border-stone-800 dark:bg-stone-900/60">
        <h1 class="font-serif text-2xl font-medium tracking-tight text-stone-900 dark:text-stone-50">{title}</h1>
        <ThemeToggle mochi:hydrate />
      </header>
      <main class="mx-auto w-full max-w-5xl flex-1 px-6 py-7">
        {@render children()}
      </main>
    </div>
  </div>
</div>
