<script lang="ts">
  import { isServer, getRequestContext } from 'mochi-framework';
  import Plus from '@lucide/svelte/icons/plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Info from '@lucide/svelte/icons/info';
  import AdminLayout from './components/AdminLayout.svelte';
  import type { Product } from './lib/products';

  let { products, user }: { products: Product[]; user?: string } = $props();

  // Stub actions (create/update/delete) return a notice via fail(); surface it.
  const form = isServer ? getRequestContext().form : null;
  const notice = form && !form.ok && typeof (form.data as { notice?: string }).notice === 'string' ? (form.data as { notice: string }).notice : null;

  const money = (n: number) => `$${n.toLocaleString()}`;
</script>

<AdminLayout title="Products" active="products" {user}>
  <div class="mb-6 flex items-center justify-between gap-4">
    <p class="text-sm text-stone-500 dark:text-stone-400">{products.length} products</p>
    <a
      href="/products/new/"
      class="inline-flex items-center gap-1.5 rounded-lg bg-matcha-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-matcha-700 focus-visible:ring-2 focus-visible:ring-matcha-300 focus-visible:outline-none"
    >
      <Plus size={16} strokeWidth={2.2} />
      New product
    </a>
  </div>

  {#if notice}
    <div
      class="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
      role="status"
    >
      <Info size={16} strokeWidth={1.9} class="mt-0.5 shrink-0" />
      <span>{notice}</span>
    </div>
  {/if}

  <div class="overflow-hidden rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
    <div class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-stone-200 text-xs tracking-wide text-stone-500 uppercase dark:border-stone-800 dark:text-stone-400">
          <tr>
            <th class="px-5 py-3 font-medium">Name</th>
            <th class="px-5 py-3 font-medium">SKU</th>
            <th class="px-5 py-3 text-right font-medium">Price</th>
            <th class="px-5 py-3 text-right font-medium">Stock</th>
            <th class="px-5 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-stone-100 dark:divide-stone-800">
          {#each products as p (p.id)}
            <tr class="transition hover:bg-stone-50 dark:hover:bg-stone-800/50">
              <td class="px-5 py-3.5 font-medium text-stone-900 dark:text-stone-100">{p.name}</td>
              <td class="px-5 py-3.5 font-mono text-xs text-stone-500 dark:text-stone-400">{p.sku}</td>
              <td class="px-5 py-3.5 text-right tabular-nums text-stone-700 dark:text-stone-300">{money(p.price)}</td>
              <td class="px-5 py-3.5 text-right">
                {#if p.stock === 0}
                  <span class="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">Out</span>
                {:else}
                  <span class="tabular-nums text-stone-700 dark:text-stone-300">{p.stock}</span>
                {/if}
              </td>
              <td class="px-5 py-3.5">
                <div class="flex items-center justify-end gap-1">
                  <a
                    href="/products/{p.id}/edit/"
                    aria-label="Edit {p.name}"
                    title="Edit"
                    class="inline-flex size-8 items-center justify-center rounded-lg text-stone-400 transition hover:bg-stone-100 hover:text-matcha-600 dark:hover:bg-stone-800 dark:hover:text-matcha-400"
                  >
                    <Pencil size={15} strokeWidth={1.9} />
                  </a>
                  <form method="POST" action="/products/?/delete" class="contents">
                    <input type="hidden" name="id" value={p.id} />
                    <button
                      type="submit"
                      aria-label="Delete {p.name}"
                      title="Delete"
                      class="inline-flex size-8 items-center justify-center rounded-lg text-stone-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                    >
                      <Trash2 size={15} strokeWidth={1.9} />
                    </button>
                  </form>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</AdminLayout>
