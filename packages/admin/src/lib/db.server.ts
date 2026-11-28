import { SEED_PRODUCTS, type Product } from './products';

// Database + migrations stub.
//
// STUB MODULE. Reads return the in-code seed rows; writes are no-ops. Once the
// migrations + bun:sqlite batteries land (tasks/migrations.md), swap the seed
// array for a real `Database` handle and run `migrations/*.sql` on boot.
//
// `.server.ts` keeps `bun:sqlite` (and the data layer) out of client bundles —
// see packages/docs/73-server-only-imports.md.

/**
 * Apply pending SQL migrations from `src/migrations/` and record applied
 * versions.
 *
 * TODO: implement (tasks/migrations.md) — open the DB with `bun:sqlite`, create
 * a `_migrations` bookkeeping table, and run each unapplied `NNN_*.sql` file in
 * order inside a transaction. Called once from src/index.ts at startup.
 */
export function runMigrations(): void {
  // TODO: execute src/migrations/*.sql against a bun:sqlite database.
}

export function listProducts(): Product[] {
  // TODO: SELECT * FROM products ORDER BY id;
  return [...SEED_PRODUCTS];
}

export function getProduct(id: number): Product | null {
  // TODO: SELECT * FROM products WHERE id = ?;
  return SEED_PRODUCTS.find((p) => p.id === id) ?? null;
}

export function createProduct(_data: Omit<Product, 'id'>): Product {
  // TODO: INSERT INTO products (...) VALUES (...) RETURNING *;
  throw new Error('createProduct is not implemented — see tasks/migrations.md');
}

export function updateProduct(_id: number, _data: Omit<Product, 'id'>): Product {
  // TODO: UPDATE products SET ... WHERE id = ? RETURNING *;
  throw new Error('updateProduct is not implemented — see tasks/migrations.md');
}

export function deleteProduct(_id: number): void {
  // TODO: DELETE FROM products WHERE id = ?;
  throw new Error('deleteProduct is not implemented — see tasks/migrations.md');
}
