/**
 * The dev server evaluates the site's first-party modules more than once, so a module-level `let` would give each copy
 * its own cache and a watcher invalidation would clear one the request path never reads.
 */
export function sharedCache<T extends object>(key: string, create: () => T): T {
  const store = globalThis as unknown as Record<string, unknown>;
  store[key] ??= create();
  return store[key] as T;
}
