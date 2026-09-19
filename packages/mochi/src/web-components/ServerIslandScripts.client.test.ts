// A page whose only hydratable is deferred ships no hydration bootstrap of its own, so the island endpoint appends one
// to the fragment — and `innerHTML` leaves it inert, which used to mean such a page never hydrated at all. Asserted
// structurally rather than by observing execution: happy-dom runs innerHTML scripts (browsers do not), so "did it run"
// would be green either way; "is there a freshly created element in <head>" is what actually separates the two.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/', settings: { handleDisabledFileLoadingAsSuccess: true } });

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { reloadDeferredIsland } from '../islands/deferInvalidation';

// Importing for the side effect of `customElements.define`, after the DOM globals exist.
await import('./ServerIsland');

const BOOTSTRAP = '/_mochi/client/HydratableIsland-abc123.js';

let bodies: string[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  bodies = [];
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

const settle = () => new Promise((r) => setTimeout(r, 0));
const headScripts = () => [...document.head.querySelectorAll('script[src]')].map((s) => (s as HTMLScriptElement).src);
const islandBody = (src: string) =>
  `<mochi-hydratable-island component-name="Counter_abc"><button>count 0</button></mochi-hydratable-island><script type="module" src="${src}"></script>`;

describe('<mochi-server-island> script activation', () => {
  test('the endpoint bootstrap becomes a live script in <head>', async () => {
    bodies = [islandBody(BOOTSTRAP)];
    const el = mount();
    await settle();

    expect(headScripts()).toEqual([`http://localhost${BOOTSTRAP}`]);
    expect(document.head.querySelector('script[src]')?.getAttribute('type')).toBe('module');
    // The inert copy is gone, so nothing is left claiming to be a loaded script.
    expect(el.querySelector('script[src]')).toBeNull();
    expect(el.querySelector('mochi-hydratable-island')).not.toBeNull();
  });

  test('a second island carrying the same bootstrap does not load it twice', async () => {
    bodies = [islandBody(BOOTSTRAP), islandBody(BOOTSTRAP)];
    mount();
    mount();
    await settle();

    expect(headScripts()).toEqual([`http://localhost${BOOTSTRAP}`]);
  });

  test('a bootstrap the page already shipped is not re-added', async () => {
    const existing = document.createElement('script');
    existing.type = 'module';
    existing.src = BOOTSTRAP;
    document.head.appendChild(existing);

    bodies = [islandBody(BOOTSTRAP)];
    mount();
    await settle();

    expect(headScripts()).toEqual([`http://localhost${BOOTSTRAP}`]);
    expect(document.head.querySelector('script[src]')).toBe(existing);
  });

  test('a reload activates scripts too', async () => {
    const next = '/_mochi/client/HydratableIsland-def456.js';
    bodies = [islandBody(BOOTSTRAP), islandBody(next)];
    mount({ name: 'counter' });
    await settle();

    await reloadDeferredIsland('counter');
    expect(headScripts()).toEqual([`http://localhost${BOOTSTRAP}`, `http://localhost${next}`]);
  });

  test('non-executable blocks stay where the server put them', async () => {
    bodies = [`<script type="application/json" id="mochi-props-0" src="/props.json"></script><p>content</p>`];
    const el = mount();
    await settle();

    expect(headScripts()).toEqual([]);
    expect(el.querySelector('#mochi-props-0')).not.toBeNull();
  });
});
