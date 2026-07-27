// Pin a value on `globalThis` keyed by a string. Used so duplicate bundled
// copies of `mochi-framework` (server runtime + per-component SSR bundles +
// client islands) share one instance per process. The factory runs at most
// once per key per realm.
export function pinGlobal<T>(key: string, factory: () => T): T {
  const slot = globalThis as unknown as Record<string, unknown>;
  slot[key] ??= factory();
  return slot[key] as T;
}
