// Shared Product type + seed rows. Isomorphic (no server-only imports) so both
// the SSR list page and any island can reference the shape.

export interface Product {
  id: number;
  name: string;
  sku: string;
  /** Price in whole currency units (e.g. dollars). */
  price: number;
  stock: number;
}

// Hardcoded seed rows. Once the migrations + bun:sqlite batteries land, these
// move into `migrations/001_init.sql` as INSERT seeds and are read via
// `lib/db.server.ts`. See tasks/migrations.md.
export const SEED_PRODUCTS: readonly Product[] = [
  { id: 1, name: 'Mochi Pro Subscription', sku: 'MOCH-PRO', price: 30, stock: 999 },
  { id: 2, name: 'Daifuku Tee — Sakura', sku: 'TEE-SKR-01', price: 25, stock: 142 },
  { id: 3, name: 'Strawberry Plush', sku: 'PLSH-STR', price: 20, stock: 38 },
  { id: 4, name: 'Sticker Pack v3', sku: 'STK-V3', price: 5, stock: 512 },
  { id: 5, name: 'Hoodie — Matcha', sku: 'HD-MTC', price: 60, stock: 0 },
];
