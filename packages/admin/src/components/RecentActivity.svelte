<script lang="ts">
  import { isServer } from 'mochi-framework';

  // Server island (mochi:defer): the page ships without this list, then fetches
  // it from /_mochi/island/RecentActivity after load. The artificial 2s delay
  // simulates a slow query so the loading state (the fallback in Dashboard) is
  // visible. The guard keeps the sleep server-only.
  await (isServer ? Bun.sleep(2000) : Promise.resolve());

  // A real app would read these from the database inside the island.
  const activity = [
    { who: 'Sakura T.', what: 'placed an order', when: '2m ago' },
    { who: 'admin', what: 'updated “Hoodie — Matcha”', when: '1h ago' },
    { who: 'Kenji M.', what: 'requested a refund', when: '3h ago' },
    { who: 'admin', what: 'added “Sticker Pack v3”', when: 'Yesterday' },
  ];
</script>

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
