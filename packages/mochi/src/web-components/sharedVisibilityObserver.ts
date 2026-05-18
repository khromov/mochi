/// <reference lib="dom" />

import { pinGlobal } from '../globalState';

// Pool is process-wide so the inline ServerIsland bundle and the hydration
// HydratableIsland bundle share observers at runtime.
//
// Cleanup: when an element intersects we `unobserve` and drop the callback.
// If an element is removed from the DOM *before* it ever intersects, neither
// runs — the IntersectionObserver keeps a strong ref to the (now-detached)
// node for the rest of the page's lifetime. Bounded by page lifetime, so not
// a real leak; revisit if islands churn faster than expected.
type Entry = {
  observer: IntersectionObserver;
  callbacks: WeakMap<Element, () => void>;
};
type Pool = Map<string, Entry>;

const pool = pinGlobal<Pool>('__mochi_visibility_pool__', () => new Map<string, Entry>());

export function observeVisible(target: Element, rootMargin: string, onVisible: () => void): void {
  let entry = pool.get(rootMargin);
  if (!entry) {
    const callbacks = new WeakMap<Element, () => void>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) {
            continue;
          }
          const cb = callbacks.get(e.target);
          if (!cb) {
            continue;
          }
          observer.unobserve(e.target);
          callbacks.delete(e.target);
          cb();
        }
      },
      { rootMargin },
    );
    entry = { observer, callbacks };
    pool.set(rootMargin, entry);
  }
  if (entry.callbacks.has(target)) {
    return;
  }
  entry.callbacks.set(target, onVisible);
  entry.observer.observe(target);
}
