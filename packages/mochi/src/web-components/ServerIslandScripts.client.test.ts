// A page whose only hydratable is deferred ships no hydration bootstrap of its own, so the island endpoint appends one
// to the fragment — and `innerHTML` leaves it inert, which used to mean such a page never hydrated at all. Activation is
// gated so the common paths (bootstrap already in the document, or nothing to hydrate) do no DOM work at all: the spy
// on `activateIslandScripts` is what proves the gate held. Asserted structurally rather than by observing execution:
// happy-dom runs innerHTML scripts (browsers do not), so "did it run" would be green either way.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/', settings: { handleDisabledFileLoadingAsSuccess: true } });

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { reloadDeferredIsland } from '../islands/deferInvalidation';
import { activateIslandScripts as realActivate } from './activateIslandScripts';

// Wrapped rather than replaced, so the real activation still runs whenever the gate lets it through.
const real = realActivate;
const activate = mock((root: Element) => real(root));
mock.module('./activateIslandScripts', () => ({ activateIslandScripts: activate }));

// Importing for the side effect of `customElements.define`, after the DOM globals exist.
await import('./ServerIsland');

const BOOTSTRAP = '/_mochi/client/HydratableIsland-abc123.js';

let bodies: string[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  bodies = [];
  activate.mockClear();
  delete window.__mochi_bootstrap;
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  globalThis.fetch = (async () => {
    const body = bodies.shift() ?? '<p>no body queued</p>';
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
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

// What the shell emits ahead of `customElements.define` on a page that shipped the bootstrap tag.
function shipBootstrap(): HTMLScriptElement {
  const existing = document.createElement('script');
  existing.type = 'module';
  existing.src = BOOTSTRAP;
  document.head.appendChild(existing);
  window.__mochi_bootstrap = true;
  return existing;
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const headScripts = () => [...document.head.querySelectorAll('script[src]')].map((s) => (s as HTMLScriptElement).src);
const islandBody = (src: string) =>
  `<mochi-hydratable-island component-name="Counter_abc"><button>count 0</button></mochi-hydratable-island><script type="module" src="${src}"></script>`;

describe('<mochi-server-island> bootstrap activation', () => {
  test('the endpoint bootstrap becomes a live script in <head> and marks the document', async () => {
    bodies = [islandBody(BOOTSTRAP)];
    const el = mount();
    await settle();

    expect(activate).toHaveBeenCalledTimes(1);
    expect(headScripts()).toEqual([`http://localhost${BOOTSTRAP}`]);
    expect(document.head.querySelector('script[src]')?.getAttribute('type')).toBe('module');
    // The inert copy is gone, so nothing is left claiming to be a loaded script.
    expect(el.querySelector('script[src]')).toBeNull();
    expect(el.querySelector('mochi-hydratable-island')).not.toBeNull();
    expect(window.__mochi_bootstrap).toBe(true);
  });

  test('two islands landing together activate it once; the second does no work', async () => {
    bodies = [islandBody(BOOTSTRAP), islandBody(BOOTSTRAP)];
    mount();
    const second = mount();
    await settle();

    expect(activate).toHaveBeenCalledTimes(1);
    expect(headScripts()).toEqual([`http://localhost${BOOTSTRAP}`]);
    // Untouched: the second fragment's copy is still where the server put it.
    expect(second.querySelector('script[src]')).not.toBeNull();
  });

  test('a page that shipped the bootstrap does no activation work at all', async () => {
    const existing = shipBootstrap();

    bodies = [islandBody(BOOTSTRAP)];
    const el = mount();
    await settle();

    expect(activate).not.toHaveBeenCalled();
    expect(headScripts()).toEqual([`http://localhost${BOOTSTRAP}`]);
    expect(document.head.querySelector('script[src]')).toBe(existing);
    expect(el.querySelector('script[src]')).not.toBeNull();
    expect(el.querySelector('mochi-hydratable-island')).not.toBeNull();
  });

  test('a fragment with nothing to hydrate does no activation work', async () => {
    bodies = ['<p>plain content</p>'];
    const el = mount();
    await settle();

    expect(activate).not.toHaveBeenCalled();
    expect(el.innerHTML).toBe('<p>plain content</p>');
    expect(window.__mochi_bootstrap).toBeUndefined();
  });

  test('a reload activates the bootstrap the moment it first appears, and only then', async () => {
    bodies = ['<p>no hydratables yet</p>', islandBody(BOOTSTRAP), islandBody(BOOTSTRAP)];
    const el = mount({ name: 'counter' });
    await settle();
    expect(activate).not.toHaveBeenCalled();

    await reloadDeferredIsland('counter');
    expect(activate).toHaveBeenCalledTimes(1);
    expect(headScripts()).toEqual([`http://localhost${BOOTSTRAP}`]);
    expect(el.querySelector('script[src]')).toBeNull();

    await reloadDeferredIsland('counter');
    expect(activate).toHaveBeenCalledTimes(1);
    expect(headScripts()).toEqual([`http://localhost${BOOTSTRAP}`]);
    expect(el.querySelector('script[src]')).not.toBeNull();
  });

  test('non-executable blocks stay where the server put them', async () => {
    bodies = [`<p>content</p><script type="application/json" id="mochi-props-0" src="/props.json"></script>`];
    const el = mount();
    await settle();

    expect(activate).toHaveBeenCalledTimes(1);
    expect(headScripts()).toEqual([]);
    expect(el.querySelector('#mochi-props-0')).not.toBeNull();
    // Nothing was activated, so the next fragment that carries a bootstrap still gets its chance.
    expect(window.__mochi_bootstrap).toBeUndefined();
  });
});
