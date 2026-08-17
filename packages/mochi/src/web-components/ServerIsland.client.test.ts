// The <mochi-server-island> element driven through a real DOM: registration lifecycle, reload queueing, and the
// teardown of hydrated children before a reload swaps the subtree. These paths are invisible to the pure-registry
// tests in ../islands/deferInvalidation.test.ts, which exercise the Map/Set bookkeeping against a stub.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { reloadDeferredIsland, reloadDeferredIslandAll, isReloadingDeferredIsland, subscribeDeferredIsland } from '../islands/deferInvalidation';

// Importing for the side effect of `customElements.define`, after the DOM globals exist.
await import('./ServerIsland');

let bodies: string[] = [];
let inflight = 0;
let maxInflight = 0;
// Holds the *next* fetch only, so a test can pin one request open and observe what a concurrent caller does.
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

  // Regression: reload used to race the connectedCallback fetch, so two requests were in flight at once and the
  // slower (older) response could land last and clobber the newer content the caller had already been handed.
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

  test('isReloadingDeferredIsland flips synchronously and clears once settled', async () => {
    holdNext = true;
    mount({ name: 'clock' });
    // True during the very first load too: fresh HTML is already inbound.
    expect(isReloadingDeferredIsland('clock')).toBe(true);
    release?.();
    await settle();
    expect(isReloadingDeferredIsland('clock')).toBe(false);

    holdNext = true;
    const reloaded = reloadDeferredIsland('clock');
    // No await — the guard must be usable at the top of a click handler.
    expect(isReloadingDeferredIsland('clock')).toBe(true);

    await settle();
    release?.();
    await reloaded;
    expect(isReloadingDeferredIsland('clock')).toBe(false);
  });

  test('isReloadingDeferredIsland is false for unknown and unnamed islands', async () => {
    mount(null);
    await settle();
    expect(isReloadingDeferredIsland('nope')).toBe(false);
  });

  test('a reload shows the original fallback, then the new content', async () => {
    const el = mount({ name: 'clock' }, '<div class="skeleton">Loading…</div>');
    await settle();
    expect(el.innerHTML).toBe('<p>render 1</p>');

    holdNext = true;
    const reloaded = reloadDeferredIsland('clock');
    await settle();
    expect(el.innerHTML).toBe('<div class="skeleton">Loading…</div>');
    expect(el.hasAttribute('data-reloading')).toBe(true);
    expect(el.getAttribute('aria-busy')).toBe('true');

    release?.();
    await reloaded;
    expect(el.innerHTML).toBe('<p>render 2</p>');
    expect(el.hasAttribute('data-reloading')).toBe(false);
    expect(el.hasAttribute('aria-busy')).toBe(false);
  });

  test('a failed reload restores the content it was showing', async () => {
    const el = mount({ name: 'clock', retries: 0 }, '<div class="skeleton">Loading…</div>');
    await settle();
    expect(el.innerHTML).toBe('<p>render 1</p>');

    globalThis.fetch = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await reloadDeferredIsland('clock');

    expect(el.innerHTML).toBe('<p>render 1</p>');
    expect(el.hasAttribute('data-reloading')).toBe(false);
  });

  test('a reload dispatches bubbling start/end events carrying the outcome', async () => {
    const el = mount({ name: 'clock' });
    await settle();

    const seen: string[] = [];
    let endDetail: Record<string, unknown> | null = null;
    document.addEventListener('mochi:island:reloadstart', () => seen.push('start'));
    document.addEventListener('mochi:island:reloadend', (e) => {
      seen.push('end');
      endDetail = (e as CustomEvent).detail;
    });

    await reloadDeferredIsland('clock');

    expect(seen).toEqual(['start', 'end']);
    expect(endDetail).toMatchObject({ name: 'clock', component: 'Clock_abc', ok: true });
    expect(el.innerHTML).toBe('<p>render 2</p>');
  });

  // `DeferReloadState` is a rune module and so cannot be imported here (plain `bun test` never
  // compiles it). What is testable — and what its every field is derived from — is the payload
  // it subscribes to, so that contract is pinned here instead.
  test('the settle notification carries the reload outcome', async () => {
    mount({ name: 'clock', retries: 0 });
    await settle();

    const changes: Array<{ ok?: boolean; reloading: boolean }> = [];
    const unsubscribe = subscribeDeferredIsland('clock', (change) => changes.push({ ...change, reloading: isReloadingDeferredIsland('clock') }));

    await reloadDeferredIsland('clock');
    expect(changes).toEqual([{ reloading: true }, { ok: true, reloading: false }]);

    globalThis.fetch = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await reloadDeferredIsland('clock');
    expect(changes[3]).toEqual({ ok: false, reloading: false });

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

  // The accessor is only reactive because subscribers fire on both edges; without this the
  // value would be correct on read but never prompt a re-read.
  test('subscribers fire when a reload starts and when it finishes', async () => {
    mount({ name: 'clock' });
    await settle();

    const seen: boolean[] = [];
    const unsubscribe = subscribeDeferredIsland('clock', () => seen.push(isReloadingDeferredIsland('clock')));

    await reloadDeferredIsland('clock');
    expect(seen).toEqual([true, false]);

    unsubscribe();
    await reloadDeferredIsland('clock');
    expect(seen).toEqual([true, false]);
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

  test('hydrated children are unmounted before the fallback replaces them', async () => {
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
    // Torn down as soon as the skeleton goes up, not only when the new HTML lands.
    expect(unmounted).toBe(1);

    release?.();
    await reloaded;
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
});
