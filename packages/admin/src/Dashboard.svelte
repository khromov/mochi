<script lang="ts">
  import DollarSign from '@lucide/svelte/icons/dollar-sign';
  import ShoppingBag from '@lucide/svelte/icons/shopping-bag';
  import Users from '@lucide/svelte/icons/users';
  import Package from '@lucide/svelte/icons/package';
  import AdminLayout from './components/AdminLayout.svelte';
  import StatCard from './components/StatCard.svelte';
  import RevenueSparkline from './components/RevenueSparkline.svelte';
  import LiveTrafficChart from './components/LiveTrafficChart.svelte';
  import RecentActivity from './components/RecentActivity.svelte';
  import { REVENUE_TREND } from './lib/analytics';

  let { user }: { user?: string } = $props();

  // Hardcoded demo stats — a real app derives these from the database.
  const stats = [
    { label: 'Revenue (30d)', value: '$48,290', delta: '+12.4%', trend: 'up' as const, icon: DollarSign },
    { label: 'Orders', value: '1,284', delta: '+3.1%', trend: 'up' as const, icon: ShoppingBag },
    { label: 'Customers', value: '892', delta: '+5.8%', trend: 'up' as const, icon: Users },
    { label: 'Products', value: '5', delta: '−2 low stock', trend: 'down' as const, icon: Package },
  ];
</script>

<AdminLayout title="Dashboard" active="dashboard" {user}>
  <p class="mb-6 text-sm text-stone-500 dark:text-stone-400">A quick snapshot of the store. All figures are demo data.</p>

  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
    {#each stats as s (s.label)}
      <StatCard label={s.label} value={s.value} delta={s.delta} trend={s.trend} icon={s.icon} />
    {/each}
  </div>

  <div class="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
    <!-- Non-hydrated chart: server-rendered SVG, ships no JS. -->
    <section class="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <div class="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 class="font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-50">Revenue</h2>
          <p class="text-xs text-stone-400">Last 30 days</p>
        </div>
        <span class="rounded-full bg-stone-100 px-2 py-0.5 text-[0.62rem] font-semibold tracking-wide text-stone-500 uppercase dark:bg-stone-800 dark:text-stone-400"
          >SSR · 0 KB JS</span
        >
      </div>
      <RevenueSparkline data={REVENUE_TREND} />
    </section>

    <!-- Hydrated island: measures + animates on the client, live-updating. -->
    <section class="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <div class="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 class="font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-50">Live traffic</h2>
          <p class="text-xs text-stone-400">Requests per minute</p>
        </div>
        <span
          class="inline-flex items-center gap-1.5 rounded-full bg-matcha-50 px-2 py-0.5 text-[0.62rem] font-semibold tracking-wide text-matcha-700 uppercase dark:bg-matcha-500/10 dark:text-matcha-300"
        >
          <span class="relative flex size-1.5">
            <span class="absolute inline-flex size-full animate-ping rounded-full bg-matcha-500 opacity-75"></span>
            <span class="relative inline-flex size-1.5 rounded-full bg-matcha-500"></span>
          </span>
          Live
        </span>
      </div>
      <LiveTrafficChart mochi:hydrate />
    </section>
  </div>

  <section class="mt-8 rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
    <div class="flex items-center justify-between border-b border-stone-200 px-5 py-4 dark:border-stone-800">
      <h2 class="font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-50">Recent activity</h2>
      <span class="rounded-full bg-stone-100 px-2 py-0.5 text-[0.62rem] font-semibold tracking-wide text-stone-500 uppercase dark:bg-stone-800 dark:text-stone-400"
        >Server island</span
      >
    </div>

    <!-- Server island (mochi:defer): the list is fetched from the server after
         the page loads. The children below are the loading state shown meanwhile. -->
    <RecentActivity mochi:defer>
      <ul class="divide-y divide-stone-100 dark:divide-stone-800" aria-hidden="true">
        {#each Array.from({ length: 4 }) as _, i (i)}
          <li class="flex items-center gap-3 px-5 py-3.5">
            <span class="size-8 shrink-0 animate-pulse rounded-full bg-stone-200 dark:bg-stone-800"></span>
            <span class="h-3 animate-pulse rounded bg-stone-200 dark:bg-stone-800" style="width: {[42, 58, 48, 52][i]}%"></span>
            <span class="ml-auto h-3 w-12 shrink-0 animate-pulse rounded bg-stone-100 dark:bg-stone-800/60"></span>
          </li>
        {/each}
      </ul>
    </RecentActivity>
  </section>
</AdminLayout>
