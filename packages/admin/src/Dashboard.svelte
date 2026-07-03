<script lang="ts">
  import DollarSign from '@lucide/svelte/icons/dollar-sign';
  import ShoppingBag from '@lucide/svelte/icons/shopping-bag';
  import Users from '@lucide/svelte/icons/users';
  import Package from '@lucide/svelte/icons/package';
  import AdminLayout from './components/AdminLayout.svelte';
  import StatCard from './components/StatCard.svelte';

  let { user }: { user?: string } = $props();

  // Hardcoded demo stats — a real app derives these from the database.
  const stats = [
    { label: 'Revenue (30d)', value: '$48,290', delta: '+12.4%', trend: 'up' as const, icon: DollarSign },
    { label: 'Orders', value: '1,284', delta: '+3.1%', trend: 'up' as const, icon: ShoppingBag },
    { label: 'Customers', value: '892', delta: '+5.8%', trend: 'up' as const, icon: Users },
    { label: 'Products', value: '5', delta: '−2 low stock', trend: 'down' as const, icon: Package },
  ];

  const activity = [
    { who: 'Sakura T.', what: 'placed an order', when: '2m ago' },
    { who: 'admin', what: 'updated “Hoodie — Matcha”', when: '1h ago' },
    { who: 'Kenji M.', what: 'requested a refund', when: '3h ago' },
    { who: 'admin', what: 'added “Sticker Pack v3”', when: 'Yesterday' },
  ];
</script>

<AdminLayout title="Dashboard" active="dashboard" {user}>
  <p class="mb-6 text-sm text-stone-500 dark:text-stone-400">A quick snapshot of the store. All figures are demo data.</p>

  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
    {#each stats as s (s.label)}
      <StatCard label={s.label} value={s.value} delta={s.delta} trend={s.trend} icon={s.icon} />
    {/each}
  </div>

  <section class="mt-8 rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
    <div class="border-b border-stone-200 px-5 py-4 dark:border-stone-800">
      <h2 class="font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-50">Recent activity</h2>
    </div>
    <ul class="divide-y divide-stone-100 dark:divide-stone-800">
      {#each activity as a (a.who + a.what)}
        <li class="flex items-center gap-3 px-5 py-3.5 text-sm">
          <span
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-stone-100 font-serif text-xs font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300"
          >
            {a.who.charAt(0).toUpperCase()}
          </span>
          <span class="flex-1 text-stone-700 dark:text-stone-300">
            <span class="font-medium text-stone-900 dark:text-stone-100">{a.who}</span>
            {a.what}
          </span>
          <span class="shrink-0 text-xs text-stone-400">{a.when}</span>
        </li>
      {/each}
    </ul>
  </section>
</AdminLayout>
