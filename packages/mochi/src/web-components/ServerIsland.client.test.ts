// The element driven through a real DOM — paths the pure-registry tests in
// ../islands/deferInvalidation.test.ts cannot reach with a stub.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { reloadDeferredIsland, reloadDeferredIslandAll, isReloadingDeferredIsland, subscribeDeferredIsland } from '../islands/deferInvalidation';

// Importing for the side effect of `customElements.define`, after the DOM globals exist.
await import('./ServerIsland');

let bodies: string[] = [];
let inflight = 0;
let maxInflight = 0;
// Holds the next fetch only, so a test can pin one open and watch what a concurrent caller does.
let holdNext = false;
let release: (() => void) | null = null;

const realFetch = globalThis.fetch;

beforeEach(() => {
  bodies = [];
  inflight = 0;
  maxInflight = 0;
  holdNext = false;
  release = null;
  document.body.innerHTML = '';
  globalThis.fetch = (async () => {
    inflight++;
    maxInflight = Math.max(maxInflight, inflight);
    if (holdNext) {
      holdNext = false;
      await new Promise<void>((r) => (release = r));
    }
    inflight--;
    const body = `<p>render ${bodies.length + 1}</p>`;
    bodies.push(body);
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function mount(options: Record<string, unknown> | null, children = ''): HTMLElement {
  const el = document.createElement('mochi-server-island');
  el.setAttribute('component-name', 'Clock_abc');
  el.setAttribute('data-asset-prefix', '/_mochi');
  el.setAttribute('signed-props', 'token');
  if (options) {
    el.setAttribute('server-options', JSON.stringify(options));
  }
  el.innerHTML = children;
  document.body.appendChild(el);
  return el;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('<mochi-server-island> invalidation', () => {
  test('a named island is reloadable, and reload re-fetches', async () => {
    const el = mount({ name: 'clock' });
    await settle();
    expect(el.innerHTML).toBe('<p>render 1</p>');

    await reloadDeferredIsland('clock');
    expect(el.innerHTML).toBe('<p>render 2</p>');
  });

  test('an unnamed island is not reachable by name', async () => {
    mount(null);
    await settle();
    await reloadDeferredIslandAll();
    expect(bodies).toHaveLength(1);
  });

  test('removing an island unregisters it', async () => {
    const el = mount({ name: 'clock' });
    await settle();
    el.remove();

    await reloadDeferredIsland('clock');
    expect(bodies).toHaveLength(1);
  });

  test('re-appending a loaded island does not re-fetch but stays reloadable', async () => {
    const el = mount({ name: 'clock' });
    await settle();
    el.remove();
    document.body.appendChild(el);
    await settle();
    expect(bodies).toHaveLength(1);

    await reloadDeferredIsland('clock');
    expect(bodies).toHaveLength(2);
  });

  test('islands sharing a name reload together', async () => {
    mount({ name: 'pair' });
    mount({ name: 'pair' });
    await settle();

    await reloadDeferredIsland('pair');
    expect(bodies).toHaveLength(4);
  });

  // Regression: reload used to race the initial fetch, letting the older response land last.
  test('a reload during the initial fetch queues instead of racing it', async () => {
    holdNext = true;
    const el = mount({ name: 'clock' });
    const reloaded = reloadDeferredIsland('clock');
    await settle();

    expect(maxInflight).toBe(1);
    release?.();
    await reloaded;

    expect(maxInflight).toBe(1);
    expect(bodies).toHaveLength(2);
    expect(el.innerHTML).toBe('<p>render 2</p>');
  });

  test('the in-flight flag is set synchronously and clears once settled', async () => {
    holdNext = true;
    mount({ name: 'clock' });
    // True during the very first load too: fresh HTML is already inbound.
    expect(isReloadingDeferredIsland('clock')).toBe(true);
    release?.();
    await settle();
    expect(isReloadingDeferredIsland('clock')).toBe(false);

    holdNext = true;
    const reloaded = reloadDeferredIsland('clock');
    expect(isReloadingDeferredIsland('clock')).toBe(true);

    await settle();
    release?.();
    await reloaded;
    expect(isReloadingDeferredIsland('clock')).toBe(false);
  });

  test('the in-flight flag is false for unknown and unnamed islands', async () => {
    mount(null);
    await settle();
    expect(isReloadingDeferredIsland('nope')).toBe(false);
  });

  test('a reload keeps the current content up until the new HTML lands', async () => {
    const el = mount({ name: 'clock' }, '<div class="skeleton">Loading…</div>');
    await settle();
    expect(el.innerHTML).toBe('<p>render 1</p>');

    holdNext = true;
    const reloaded = reloadDeferredIsland('clock');
    await settle();
    expect(el.innerHTML).toBe('<p>render 1</p>');
    expect(el.hasAttribute('data-reloading')).toBe(true);
    expect(el.getAttribute('aria-busy')).toBe('true');

    release?.();
    await reloaded;
    expect(el.innerHTML).toBe('<p>render 2</p>');
    expect(el.hasAttribute('data-reloading')).toBe(false);
    expect(el.hasAttribute('aria-busy')).toBe(false);
  });

  test('a failed reload leaves the content untouched', async () => {
    const el = mount({ name: 'clock', retries: 0 }, '<div class="skeleton">Loading…</div>');
    await settle();
    expect(el.innerHTML).toBe('<p>render 1</p>');

    globalThis.fetch = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await reloadDeferredIsland('clock');

    expect(el.innerHTML).toBe('<p>render 1</p>');
    expect(el.hasAttribute('data-reloading')).toBe(false);
  });

  // `DeferReloadState` is a rune module that plain `bun test` cannot import, so what is pinned
  // here is the payload it derives every field from: two `{}` edges per element, then one
  // aggregated `{ ok }` per round from `reloadDeferredIsland`.
  test('the round notification carries the reload outcome after the edges', async () => {
    mount({ name: 'clock', retries: 0 });
    await settle();

    const changes: Array<{ ok?: boolean; reloading: boolean }> = [];
    const unsubscribe = subscribeDeferredIsland('clock', (change) => changes.push({ ...change, reloading: isReloadingDeferredIsland('clock') }));

    await reloadDeferredIsland('clock');
    expect(changes).toEqual([{ reloading: true }, { reloading: false }, { ok: true, reloading: false }]);

    globalThis.fetch = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await reloadDeferredIsland('clock');
    expect(changes[5]).toEqual({ ok: false, reloading: false });

    unsubscribe();
  });

  test('a partially failed round reports ok: false even when the success lands last', async () => {
    mount({ name: 'pair', retries: 0 });
    mount({ name: 'pair', retries: 0 });
    await settle();

    // First fetch of the round 404s immediately; the second is held open and succeeds later.
    let failed = false;
    const okFetch = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      if (!failed) {
        failed = true;
        return new Response('nope', { status: 404 });
      }
      return okFetch(...args);
    }) as typeof fetch;
    holdNext = true;

    const changes: Array<{ ok?: boolean }> = [];
    const unsubscribe = subscribeDeferredIsland('pair', (change) => changes.push(change));
    const reloaded = reloadDeferredIsland('pair');
    await settle();
    release?.();
    await reloaded;

    expect(changes.at(-1)).toEqual({ ok: false });
    unsubscribe();
  });

  test('the initial load notifies without an outcome, so it is not counted as a reload', async () => {
    const changes: Array<{ ok?: boolean }> = [];
    const unsubscribe = subscribeDeferredIsland('fresh', (change) => changes.push(change));

    mount({ name: 'fresh' });
    await settle();

    expect(changes.every((c) => c.ok === undefined)).toBe(true);
    unsubscribe();
  });

  // Reactivity depends on both edges firing; one alone reads correctly but never prompts a re-read.
  test('subscribers fire when a reload starts and when it finishes', async () => {
    mount({ name: 'clock' });
    await settle();

    const seen: boolean[] = [];
    const unsubscribe = subscribeDeferredIsland('clock', () => seen.push(isReloadingDeferredIsland('clock')));

    await reloadDeferredIsland('clock');
    expect(seen).toEqual([true, false, false]);

    unsubscribe();
    await reloadDeferredIsland('clock');
    expect(seen).toEqual([true, false, false]);
  });

  test('an unnamed island notifies nobody', async () => {
    mount(null);
    await settle();
    const seen: number[] = [];
    const unsubscribe = subscribeDeferredIsland('clock', () => seen.push(1));
    await reloadDeferredIslandAll();
    expect(seen).toEqual([]);
    unsubscribe();
  });

  test('hydrated children stay mounted until the new HTML lands', async () => {
    const el = mount({ name: 'clock' });
    await settle();

    let unmounted = 0;
    const child = document.createElement('mochi-hydratable-island');
    (child as { _unmount?: () => void })._unmount = () => unmounted++;
    el.innerHTML = '';
    el.appendChild(child);

    holdNext = true;
    const reloaded = reloadDeferredIsland('clock');
    await settle();
    // The live subtree keeps running while the fetch is in flight.
    expect(unmounted).toBe(0);

    release?.();
    await reloaded;
    expect(unmounted).toBe(1);
  });

  test('hydrated children are unmounted before the subtree is replaced', async () => {
    const el = mount({ name: 'clock' });
    await settle();

    let unmounted = 0;
    const child = document.createElement('mochi-hydratable-island');
    (child as { _unmount?: () => void })._unmount = () => unmounted++;
    el.innerHTML = '';
    el.appendChild(child);

    await reloadDeferredIsland('clock');
    expect(unmounted).toBe(1);
  });

  // The bump is what an in-flight hydration (no `_unmount` yet) compares against before mounting.
  test('discarding a subtree bumps the child generation', async () => {
    const el = mount({ name: 'clock' });
    await settle();

    const child = document.createElement('mochi-hydratable-island');
    el.innerHTML = '';
    el.appendChild(child);

    await reloadDeferredIsland('clock');
    expect((child as { _generation?: number })._generation).toBe(1);
  });

  test('an empty or non-string name is treated as unnamed', async () => {
    mount({ name: '' });
    mount({ name: 5 });
    await settle();
    expect(bodies).toHaveLength(2);

    await reloadDeferredIslandAll();
    expect(bodies).toHaveLength(2);
  });

  test('a moved island stays reloadable even if server-options was stripped', async () => {
    const el = mount({ name: 'clock' });
    await settle();

    el.remove();
    el.removeAttribute('server-options');
    document.body.appendChild(el);
    await settle();

    await reloadDeferredIsland('clock');
    expect(bodies).toHaveLength(2);
  });
});
