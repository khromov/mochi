<script lang="ts">
  import { isServer, getRequestContext } from 'mochi-framework';
  import type { Product } from '../lib/products';
  import type { FieldErrors } from '../lib/validate';

  interface Props {
    /** Existing row when editing; undefined when creating. */
    product?: Product;
    /** Form action, e.g. "?/create" or "?/update". */
    action: string;
    submitLabel: string;
  }

  let { product, action, submitLabel }: Props = $props();

  // After a failed POST the action returns fail(400, { errors, values }); read it
  // off the request context so the fields repopulate and errors show. SSR-only —
  // this form isn't an island, so there's no client re-read to diverge from.
  const form = isServer ? getRequestContext().form : null;
  const failData = form && !form.ok ? (form.data as { errors?: FieldErrors<Product>; values?: Record<string, string> }) : null;
  const errors = failData?.errors ?? {};
  const values = failData?.values ?? {};

  // Precedence: a rejected submission's value, then the existing row, then blank.
  const field = (key: keyof Product): string => values[key] ?? (product ? String(product[key]) : '');

  const fields = [
    { key: 'name' as const, label: 'Name', type: 'text', placeholder: 'Strawberry Plush', hint: '' },
    { key: 'sku' as const, label: 'SKU', type: 'text', placeholder: 'PLSH-STR', hint: 'Unique stock-keeping unit.' },
    { key: 'price' as const, label: 'Price', type: 'number', placeholder: '20', hint: 'Whole currency units.' },
    { key: 'stock' as const, label: 'Stock', type: 'number', placeholder: '0', hint: '' },
  ];
</script>

<form method="POST" {action} class="max-w-lg space-y-5">
  {#each fields as f (f.key)}
    <div>
      <label for={f.key} class="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">{f.label}</label>
      <input
        id={f.key}
        name={f.key}
        type={f.type}
        inputmode={f.type === 'number' ? 'numeric' : undefined}
        placeholder={f.placeholder}
        value={field(f.key)}
        aria-invalid={errors[f.key] ? 'true' : undefined}
        class="w-full rounded-lg border bg-white px-3 py-2 text-sm text-stone-900 transition outline-none placeholder:text-stone-400 focus:ring-2 dark:bg-stone-900 dark:text-stone-100
          {errors[f.key]
          ? 'border-rose-400 focus:border-rose-400 focus:ring-rose-200 dark:border-rose-500 dark:focus:ring-rose-500/30'
          : 'border-stone-300 focus:border-matcha-400 focus:ring-matcha-100 dark:border-stone-700 dark:focus:ring-matcha-500/25'}"
      />
      {#if errors[f.key]}
        <p class="mt-1.5 text-xs font-medium text-rose-500 dark:text-rose-400" role="alert">{errors[f.key]}</p>
      {:else if f.hint}
        <p class="mt-1.5 text-xs text-stone-400">{f.hint}</p>
      {/if}
    </div>
  {/each}

  <div class="flex items-center gap-3 pt-1">
    <button
      type="submit"
      class="inline-flex items-center rounded-lg bg-matcha-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-matcha-700 focus-visible:ring-2 focus-visible:ring-matcha-300 focus-visible:outline-none"
    >
      {submitLabel}
    </button>
    <a href="/products/" class="text-sm font-medium text-stone-500 transition hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200">Cancel</a>
  </div>
</form>
