import { Mochi, fail, success, error } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { currentUser } from '../lib/auth.server';
import { listProducts, getProduct } from '../lib/db.server';
import { validate, required, positiveNumber, type Schema } from '../lib/validate';
import type { Product } from '../lib/products';

const productSchema: Schema<Omit<Product, 'id'>> = {
  name: required('Name'),
  sku: required('SKU'),
  price: positiveNumber('Price'),
  stock: positiveNumber('Stock'),
};

const STUB_NOTICE = 'Validated ✓ — persistence is stubbed. Wire up lib/db.server.ts (see tasks/migrations.md).';

export const routes: Record<string, MochiRouteValue> = {
  '/products': Mochi.page('./src/Products.svelte', {
    serverProps: () => ({ products: listProducts(), user: currentUser() }),
    actions: {
      delete: async () => {
        // STUB: deleteProduct is a no-op; surface a notice instead of mutating.
        return fail(501, { notice: 'Delete is a stub — implement lib/db.server.ts (see tasks/migrations.md).' });
      },
    },
  }),

  '/products/new': Mochi.page('./src/ProductEdit.svelte', {
    serverProps: () => ({ user: currentUser() }),
    actions: {
      create: async ({ formData }) => {
        const result = validate(productSchema, formData);
        if (!result.ok) {
          return fail(400, { errors: result.errors, values: result.values });
        }
        // STUB: nothing persisted. Real: createProduct(result.data) then
        // redirect(303, '/products/'). We re-render with a success notice so the
        // validation path is visibly exercised.
        return success({ notice: STUB_NOTICE });
      },
    },
  }),

  '/products/:id/edit': Mochi.page('./src/ProductEdit.svelte', {
    serverProps: (_req, params) => {
      const product = getProduct(Number(params.id));
      if (!product) {
        error(404, 'Product not found');
      }
      return { product, user: currentUser() };
    },
    actions: {
      update: async ({ formData }) => {
        const result = validate(productSchema, formData);
        if (!result.ok) {
          return fail(400, { errors: result.errors, values: result.values });
        }
        // STUB: nothing persisted. Real: updateProduct(id, result.data).
        return success({ notice: STUB_NOTICE });
      },
    },
  }),
};
