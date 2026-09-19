// The element driven through happy-dom against the bootstrap marker the island endpoint leads a fragment with. The
// marker names a real module here (Bun evaluates `import()` of a file: URL), so the tests observe evaluation and the
// module-map dedupe directly instead of asserting on DOM shape — nothing is added to the DOM by design.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { reloadDeferredIsland, subscribeDeferredIsland } from '../islands/deferInvalidation';
import { BOOTSTRAP_MARKER_ATTR } from '../islands/bootstrapMarker';

// Importing for the side effect of `customElements.define`, after the DOM globals exist.
await import('./ServerIsland');

const STUB = pathToFileURL(path.join(import.meta.dir, '..', '__fixtures__', 'defer-hydrate-standalone', 'bootstrapStub.ts')).href;

let bodies: string[] = [];
let warnings: string[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  bodies = [];
  warnings = [];
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  window.__mochi_warn = (msg) => warnings.push(msg);
  // The failure tests would otherwise print the same message through console.error.
  window.__mochi_log_level = 'silent';
  globalThis.fetch = (async () => {
    const body = bodies.shift() ?? '<p>no body queued</p>';
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete window.__mochi_warn;
});

function mount(options: Record<string, unknown> | null = null): HTMLElement {
  const el = document.createElement('mochi-server-island');
  el.setAttribute('component-name', 'Counter_abc');
  el.setAttribute('data-asset-prefix', '/_mochi');
  el.setAttribute('signed-props', 'token');
  el.setAttribute('also-hydrate', 'eager');
  if (options) {
    el.setAttribute('server-options', JSON.stringify(options));
  }
  document.body.appendChild(el);
  return el;
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const runs = () => globalThis.__mochi_bootstrap_stub_runs ?? 0;
const marker = (url: string) => `<template ${BOOTSTRAP_MARKER_ATTR}="${url}"></template>`;
const fragment = (url: string) => `${marker(url)}<mochi-hydratable-island component-name="Counter_abc"><button>count 0</button></mochi-hydratable-island>`;

describe('<mochi-server-island> bootstrap marker', () => {
  // First so the stub is still unevaluated: the count going 0 → 1 with two islands landing together is what proves
  // both that the marker triggers the import and that the module map collapses the two into one evaluation.
  test('two islands landing together consume their markers and evaluate the bootstrap once', async () => {
    expect(runs()).toBe(0);
    bodies = [fragment(STUB), fragment(STUB)];
    const a = mount();
    const b = mount();
    await settle();
    await settle();

    expect(runs()).toBe(1);
    for (const el of [a, b]) {
      expect(el.querySelector(`[${BOOTSTRAP_MARKER_ATTR}]`)).toBeNull();
      expect(el.firstElementChild?.tagName).toBe('MOCHI-HYDRATABLE-ISLAND');
      expect(el.querySelector('mochi-hydratable-island')?.hasAttribute('data-upgraded')).toBe(true);
    }
    expect(document.querySelectorAll('script')).toHaveLength(0);
    expect(warnings).toEqual([]);
  });

  test('a reload consumes the marker again without re-evaluating the bootstrap', async () => {
    bodies = [fragment(STUB), fragment(STUB)];
    const el = mount({ name: 'counter' });
    await settle();

    await reloadDeferredIsland('counter');
    await settle();
    expect(runs()).toBe(1);
    expect(el.querySelector(`[${BOOTSTRAP_MARKER_ATTR}]`)).toBeNull();
    expect(el.querySelector('mochi-hydratable-island')?.hasAttribute('data-upgraded')).toBe(true);
  });

  test('a fragment without a marker is inserted untouched and imports nothing', async () => {
    bodies = ['<p class="first">plain</p><p>content</p>'];
    const el = mount();
    await settle();
    await settle();

    expect(el.innerHTML).toBe('<p class="first">plain</p><p>content</p>');
    expect(runs()).toBe(1);
    expect(warnings).toEqual([]);
  });

  test('a bootstrap that fails to load is reported and leaves the content in place', async () => {
    bodies = [fragment('/_mochi/client/HydratableIsland-missing.js')];
    const el = mount();
    await settle();
    await settle();

    expect(el.querySelector(`[${BOOTSTRAP_MARKER_ATTR}]`)).toBeNull();
    expect(el.querySelector('mochi-hydratable-island')).not.toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('failed to load the hydration bootstrap /_mochi/client/HydratableIsland-missing.js');
  });

  test('the fetch outcome does not wait on the bootstrap', async () => {
    bodies = [fragment('/_mochi/client/HydratableIsland-missing.js')];
    mount({ name: 'counter', retries: 0 });
    await settle();

    // A reload round reports the fetch, not the render: a missing bootstrap must not flip it to a failure.
    bodies = [fragment('/_mochi/client/HydratableIsland-missing.js')];
    let ok: boolean | undefined;
    const unsubscribe = subscribeDeferredIsland('counter', (change) => {
      if (change.ok !== undefined) {
        ok = change.ok;
      }
    });
    await reloadDeferredIsland('counter');
    unsubscribe();
    expect(ok).toBe(true);
  });
});
