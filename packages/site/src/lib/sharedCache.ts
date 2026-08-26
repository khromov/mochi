/**
 * Cache state pinned on `globalThis` so every copy of a module shares it.
 *
 * The dev server evaluates the site's first-party modules more than once — the entry runs under Bun while each page's
 * `serverProps` is bundled separately — so a module-level `let` gives each copy its own cache, and an invalidation from
 * the file watcher clears one the request path never reads. Same reason the framework pins its request context.
 */
export function sharedCache<T extends object>(key: string, create: () => T): T {
  const store = globalThis as unknown as Record<string, unknown>;
  store[key] ??= create();
  return store[key] as T;
}
