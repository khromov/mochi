<script lang="ts">
  import { isServer, getRequestContext } from 'mochi-framework';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import AdminLayout from './components/AdminLayout.svelte';
  import ProductForm from './components/ProductForm.svelte';
  import type { Product } from './lib/products';

  let { product, user }: { product?: Product; user?: string } = $props();

  const isEdit = $derived(product !== undefined);
  const title = $derived(isEdit ? 'Edit product' : 'New product');

  // A validated (but stubbed) submit returns success({ notice }); show it.
  const form = isServer ? getRequestContext().form : null;
  const notice = form && form.ok && typeof (form.data as { notice?: string }).notice === 'string' ? (form.data as { notice: string }).notice : null;
</script>

<AdminLayout {title} active="products" {user}>
  <a
    href="/products/"
    class="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 transition hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
  >
    <ArrowLeft size={15} strokeWidth={2} />
    Back to products
  </a>

  {#if notice}
    <div
      class="mb-5 flex items-start gap-2.5 rounded-xl border border-matcha-300 bg-matcha-50 px-4 py-3 text-sm text-matcha-800 dark:border-matcha-500/40 dark:bg-matcha-500/10 dark:text-matcha-200"
      role="status"
    >
      <CircleCheck size={16} strokeWidth={1.9} class="mt-0.5 shrink-0" />
      <span>{notice}</span>
    </div>
  {/if}

  <div class="rounded-2xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900">
    <ProductForm {product} action={isEdit ? '?/update' : '?/create'} submitLabel={isEdit ? 'Save changes' : 'Create product'} />
  </div>
</AdminLayout>
