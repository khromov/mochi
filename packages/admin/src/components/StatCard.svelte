<script lang="ts">
  import TrendingUp from '@lucide/svelte/icons/trending-up';
  import TrendingDown from '@lucide/svelte/icons/trending-down';
  import type { Component } from 'svelte';

  interface Props {
    label: string;
    value: string;
    delta?: string;
    trend?: 'up' | 'down';
    icon: Component;
  }

  let { label, value, delta, trend = 'up', icon }: Props = $props();
  const Icon = $derived(icon);
</script>

<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
  <div class="flex items-start justify-between">
    <span class="text-sm text-stone-500 dark:text-stone-400">{label}</span>
    <span class="inline-flex size-9 items-center justify-center rounded-xl bg-matcha-50 text-matcha-600 dark:bg-matcha-500/10 dark:text-matcha-400">
      <Icon size={18} strokeWidth={1.8} />
    </span>
  </div>
  <p class="mt-3 font-serif text-3xl font-medium tracking-tight text-stone-900 tabular-nums dark:text-stone-50">{value}</p>
  {#if delta}
    <p class="mt-1.5 inline-flex items-center gap-1 text-xs font-medium {trend === 'up' ? 'text-matcha-600 dark:text-matcha-400' : 'text-rose-500 dark:text-rose-400'}">
      {#if trend === 'up'}
        <TrendingUp size={13} strokeWidth={2} />
      {:else}
        <TrendingDown size={13} strokeWidth={2} />
      {/if}
      {delta}
    </p>
  {/if}
</div>
