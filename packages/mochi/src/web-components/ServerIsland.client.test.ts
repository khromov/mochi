// The <mochi-server-island> element driven through a real DOM: registration lifecycle, reload queueing, and the
// teardown of hydrated children before a reload swaps the subtree. These paths are invisible to the pure-registry
// tests in ../islands/deferInvalidation.test.ts, which exercise the Map/Set bookkeeping against a stub.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { reloadDeferredIsland, reloadDeferredIslandAll, isReloadingDeferredIsland } from '../islands/deferInvalidation';

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
